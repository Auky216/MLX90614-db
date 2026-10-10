/*
  ESP32 + MLX90614 -> iPhone por Bluetooth Low Energy

  Instala en Arduino IDE:
  - Adafruit MLX90614
  - ESP32 by Espressif Systems (incluye BLEDevice)

  Conexiones del MLX90614:
  - SDA -> GPIO 21
  - SCL -> GPIO 22
  - VCC -> 3V3
  - GND -> GND

  Este sketch no usa Wi-Fi, MQTT ni Mosquitto. La aplicación iPhone guarda
  las lecturas localmente y las sincroniza únicamente cuando se lo indicas.
*/

#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

// Deben coincidir con mobile/src/config/ble.ts.
constexpr char DEVICE_NAME[] = "MLX90614-ESP32";
constexpr char SERVICE_UUID[] = "8c4db1e6-63ec-4d5b-9389-1d9b29d2f201";
constexpr char READING_CHARACTERISTIC_UUID[] = "8c4db1e6-63ec-4d5b-9389-1d9b29d2f202";
constexpr uint32_t READING_INTERVAL_MS = 1000;

Adafruit_MLX90614 mlx;
BLECharacteristic* readingCharacteristic = nullptr;
bool iphoneConnected = false;
uint32_t sequence = 0;
uint32_t lastReadingAt = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    iphoneConnected = true;
    Serial.println("iPhone conectado por BLE");
  }

  void onDisconnect(BLEServer* server) override {
    iphoneConnected = false;
    Serial.println("iPhone desconectado; anunciando BLE nuevamente");
    server->startAdvertising();
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(21, 22);

  Serial.println("Iniciando MLX90614 BLE...");
  if (!mlx.begin()) {
    Serial.println("ERROR: No se encontró el sensor MLX90614");
    while (true) delay(1000);
  }

  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  readingCharacteristic = service->createCharacteristic(
    READING_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  readingCharacteristic->addDescriptor(new BLE2902());
  readingCharacteristic->setValue("{\"ambient\":0,\"object\":0,\"sequence\":0}");
  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.printf("BLE listo. Nombre: %s\n", DEVICE_NAME);
  Serial.printf("Servicio: %s\n", SERVICE_UUID);
}

void loop() {
  if (millis() - lastReadingAt < READING_INTERVAL_MS) return;
  lastReadingAt = millis();

  const float ambient = mlx.readAmbientTempC();
  const float object = mlx.readObjectTempC();
  if (isnan(ambient) || isnan(object)) {
    Serial.println("Lectura inválida del MLX90614");
    return;
  }

  char payload[100];
  snprintf(
    payload,
    sizeof(payload),
    "{\"ambient\":%.2f,\"object\":%.2f,\"sequence\":%lu}",
    ambient,
    object,
    static_cast<unsigned long>(sequence++)
  );

  readingCharacteristic->setValue(
    reinterpret_cast<uint8_t*>(payload),
    strlen(payload)
  );
  if (iphoneConnected) readingCharacteristic->notify();

  Serial.println(payload);
}
