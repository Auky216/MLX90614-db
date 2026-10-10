#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>

// =====================================================
// WIFI
// =====================================================

const char* WIFI_SSID = "iPhone de Adrian";
const char* WIFI_PASSWORD = "123456789";

// =====================================================
// MQTT
// =====================================================

const char* MQTT_HOST = "13.140.187.142";
const int MQTT_PORT = 1883;

const char* MQTT_TOPIC =
  "MLX90614/temperature";

// IMPORTANTE:
// Cada dispositivo debe tener un ID MQTT diferente.
const char* MQTT_CLIENT_ID =
  "MLX90614-esp32-01";

// =====================================================
// OBJETOS
// =====================================================

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

Adafruit_MLX90614 mlx;

// =====================================================
// TIEMPO DE PUBLICACION
// =====================================================

unsigned long ultimaPublicacion = 0;

const unsigned long INTERVALO_PUBLICACION = 1000;
// 1000 ms = 1 segundo


// =====================================================
// CONECTAR WIFI
// =====================================================

void conectarWiFi() {

  Serial.println();
  Serial.print("Conectando a WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  while (
    WiFi.status() != WL_CONNECTED
  ) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi conectado");

  Serial.print("IP del ESP32: ");
  Serial.println(WiFi.localIP());

  Serial.print("RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
}


// =====================================================
// CONECTAR MQTT
// =====================================================

void conectarMQTT() {

  while (!mqttClient.connected()) {

    Serial.print(
      "Conectando a MQTT..."
    );

    bool conectado =
      mqttClient.connect(
        MQTT_CLIENT_ID
      );

    if (conectado) {

      Serial.println(" OK");

      Serial.print("Broker: ");
      Serial.print(MQTT_HOST);
      Serial.print(":");
      Serial.println(MQTT_PORT);

    } else {

      Serial.print(
        " ERROR, codigo="
      );

      Serial.println(
        mqttClient.state()
      );

      delay(3000);
    }
  }
}


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println(
    "============================"
  );

  Serial.println(
    "MLX90614 + WIFI + MQTT"
  );

  Serial.println(
    "============================"
  );


  // ----------------------------
  // I2C
  // SDA = GPIO21
  // SCL = GPIO22
  // ----------------------------

  Wire.begin(
    21,
    22
  );


  // ----------------------------
  // MLX90614
  // ----------------------------

  Serial.println(
    "Iniciando MLX90614..."
  );

  if (!mlx.begin()) {

    Serial.println(
      "ERROR: sensor MLX90614 no encontrado"
    );

    while (true) {
      delay(1000);
    }
  }

  Serial.println(
    "MLX90614 encontrado correctamente"
  );


  // ----------------------------
  // WIFI
  // ----------------------------

  conectarWiFi();


  // ----------------------------
  // MQTT
  // ----------------------------

  mqttClient.setServer(
    MQTT_HOST,
    MQTT_PORT
  );

  conectarMQTT();
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  // Si se pierde WiFi
  if (
    WiFi.status()
    != WL_CONNECTED
  ) {

    conectarWiFi();
  }


  // Si se pierde MQTT
  if (
    !mqttClient.connected()
  ) {

    conectarMQTT();
  }


  mqttClient.loop();


  // Publicar cada segundo
  unsigned long ahora = millis();

  if (
    ahora - ultimaPublicacion
    >= INTERVALO_PUBLICACION
  ) {

    ultimaPublicacion = ahora;


    // ----------------------------
    // LEER SENSOR
    // ----------------------------

    float ambiente =
      mlx.readAmbientTempC();

    float objeto =
      mlx.readObjectTempC();


    // ----------------------------
    // CREAR JSON
    // ----------------------------

    char payload[100];

    snprintf(
      payload,
      sizeof(payload),

      "{\"ambient\":%.2f,\"object\":%.2f}",

      ambiente,
      objeto
    );


    // ----------------------------
    // PUBLICAR MQTT
    // ----------------------------

    bool enviado =
      mqttClient.publish(
        MQTT_TOPIC,
        payload
      );


    // ----------------------------
    // SERIAL
    // ----------------------------

    Serial.println();

    Serial.print(
      "Temperatura ambiente: "
    );

    Serial.print(
      ambiente,
      2
    );

    Serial.println(" C");


    Serial.print(
      "Temperatura objeto: "
    );

    Serial.print(
      objeto,
      2
    );

    Serial.println(" C");


    Serial.print(
      "MQTT: "
    );

    if (enviado) {

      Serial.println(
        "ENVIADO"
      );

    } else {

      Serial.println(
        "ERROR"
      );
    }


    Serial.print(
      "Topic: "
    );

    Serial.println(
      MQTT_TOPIC
    );


    Serial.print(
      "Payload: "
    );

    Serial.println(
      payload
    );


    Serial.println(
      "----------------------------"
    );
  }
}