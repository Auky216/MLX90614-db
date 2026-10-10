/*
  MLX90614 -> iPhone por Bluetooth Low Energy

  Librerías necesarias en Arduino IDE:
  - Adafruit MLX90614
  - ESP32 by Espressif Systems (incluye BLEDevice)

  Este sketch no usa Wi-Fi, MQTT ni Mosquitto. El iPhone recibe cada lectura
  por una característica GATT con notificaciones.
*/

#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

constexpr char DEVICE_NAME[] = "MLX90614-ESP32";
constexpr char SERVICE_UUID[] = "8c4db1e6-63ec-4d5b-9389-1d9b29d2f201";
constexpr char READING_CHARACTERISTIC_UUID[] = "8c4db1e6-63ec-4d5b-9389-1d9b29d2f202";

Adafruit_MLX90614 mlx = Adafruit_MLX90614();
BLECharacteristic* readingCharacteristic = nullptr;
bool deviceConnected = false;
uint32_t sequence = 0;
uint32_t lastMeasurementAt = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    deviceConnected = true;
    Serial.println("iPhone conectado por BLE");
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    Serial.println("iPhone desconectado; reanudando anuncio BLE");
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
  Serial.printf("BLE listo como %s\n", DEVICE_NAME);
}

void loop() {
  if (millis() - lastMeasurementAt < 1000) return;
  lastMeasurementAt = millis();

  const float ambient = mlx.readAmbientTempC();
  const float object = mlx.readObjectTempC();
  if (isnan(ambient) || isnan(object)) {
    Serial.println("Lectura inválida del MLX90614");
    return;
  }

  char payload[100];
  snprintf(payload, sizeof(payload),
    "{\"ambient\":%.2f,\"object\":%.2f,\"sequence\":%lu}",
    ambient, object, static_cast<unsigned long>(sequence++)
  );
  readingCharacteristic->setValue(reinterpret_cast<uint8_t*>(payload), strlen(payload));
  if (deviceConnected) readingCharacteristic->notify();

  Serial.println(payload);
}
