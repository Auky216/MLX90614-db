import { Platform, PermissionsAndroid } from "react-native";
import type { BleError, BleManager, Device, Subscription } from "@sfourdrinier/react-native-ble-plx";
import { decode as decodeBase64 } from "base-64";

import { BLE_DEVICE_NAME, BLE_READING_CHARACTERISTIC_UUID, BLE_SERVICE_UUID } from "@/config/ble";
import type { BlePayload, ConnectionStatus } from "@/types";

type StatusListener = (status: ConnectionStatus, message?: string) => void;
type ReadingListener = (payload: BlePayload) => void;
type BleRuntime = typeof import("@sfourdrinier/react-native-ble-plx");

const BLE_BUILD_REQUIRED_MESSAGE =
  "Bluetooth no está disponible en esta app. Reinstálala con npx expo run:ios --device --configuration Release.";

function parsePayload(encodedValue: string | null): BlePayload {
  if (!encodedValue) throw new Error("Notificación BLE vacía");
  const decoded = decodeBase64(encodedValue);
  const parsed = JSON.parse(decoded) as Partial<BlePayload>;
  if (!Number.isFinite(parsed.ambient) || !Number.isFinite(parsed.object)) {
    throw new Error("Notificación BLE con temperaturas inválidas");
  }
  return {
    ambient: Number(parsed.ambient),
    object: Number(parsed.object),
    sequence: Number.isInteger(parsed.sequence) ? Number(parsed.sequence) : undefined,
  };
}

export class MlxBleClient {
  private manager: BleManager | null = null;
  private runtime: BleRuntime | null = null;
  private device: Device | null = null;
  private monitor: Subscription | null = null;

  private getRuntime(): BleRuntime {
    if (this.runtime) return this.runtime;
    try {
      // Se carga al conectar: Expo Go o un build viejo pueden abrir la app,
      // pero solo la compilación nativa contiene el TurboModule BlePlx.
      this.runtime = require("@sfourdrinier/react-native-ble-plx") as BleRuntime;
      return this.runtime;
    } catch {
      throw new Error(BLE_BUILD_REQUIRED_MESSAGE);
    }
  }

  private getManager(): BleManager {
    if (this.manager) return this.manager;
    const { BleManager: NativeBleManager } = this.getRuntime();
    this.manager = new NativeBleManager();
    return this.manager;
  }

  async destroy(): Promise<void> {
    this.monitor?.remove();
    this.monitor = null;
    if (this.device) {
      await this.device.cancelConnection().catch(() => undefined);
      this.device = null;
    }
    this.manager?.destroy();
    this.manager = null;
  }

  async connect(status: StatusListener, onReading: ReadingListener): Promise<void> {
    await this.ensurePermission();
    const manager = this.getManager();
    const { State } = this.getRuntime();
    const state = await manager.state();
    if (state !== State.PoweredOn) throw new Error("Activa Bluetooth en el iPhone");

    status("scanning", "Buscando MLX90614-ESP32…");
    const device = await this.findSensor();
    status("connecting", `Conectando con ${device.name ?? BLE_DEVICE_NAME}…`);
    const connected = await device.connect({ timeout: 15000, autoConnect: false });
    this.device = await connected.discoverAllServicesAndCharacteristics();
    this.monitor = this.device.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_READING_CHARACTERISTIC_UUID,
      (error, characteristic) => this.handleNotification(error, characteristic?.value ?? null, onReading),
    );
    this.device.onDisconnected((error) => {
      this.monitor?.remove();
      this.monitor = null;
      this.device = null;
      status("disconnected", error?.message ?? "El ESP32 se desconectó");
    });
    status("connected", "Recibiendo lecturas por Bluetooth");
  }

  async disconnect(status?: StatusListener): Promise<void> {
    this.manager?.stopDeviceScan();
    this.monitor?.remove();
    this.monitor = null;
    if (this.device) await this.device.cancelConnection();
    this.device = null;
    status?.("disconnected", "Desconectado");
  }

  private async ensurePermission(): Promise<void> {
    if (Platform.OS !== "android") return;
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    if (
      granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] !== PermissionsAndroid.RESULTS.GRANTED ||
      granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] !== PermissionsAndroid.RESULTS.GRANTED
    ) {
      throw new Error("Se requiere permiso Bluetooth");
    }
  }

  private findSensor(): Promise<Device> {
    return new Promise((resolve, reject) => {
      const manager = this.getManager();
      const timeout = setTimeout(() => {
        manager.stopDeviceScan();
        reject(new Error(`No se encontró ${BLE_DEVICE_NAME}`));
      }, 15000);
      manager.startDeviceScan([BLE_SERVICE_UUID], null, (error, device) => {
        if (error) {
          clearTimeout(timeout);
          manager.stopDeviceScan();
          reject(error);
          return;
        }
        if (!device || (device.name !== BLE_DEVICE_NAME && device.localName !== BLE_DEVICE_NAME)) return;
        clearTimeout(timeout);
        manager.stopDeviceScan();
        resolve(device);
      });
    });
  }

  private handleNotification(error: BleError | null, value: string | null, listener: ReadingListener): void {
    if (error) return;
    try {
      listener(parsePayload(value));
    } catch {
      // Un paquete malformado no detiene una sesión de captura.
    }
  }
}
