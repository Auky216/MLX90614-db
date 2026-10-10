export const BLE_DEVICE_NAME = process.env.EXPO_PUBLIC_BLE_DEVICE_NAME ?? "MLX90614-ESP32";

// Deben coincidir con mobile/firmware/esp32_mlx90614_ble.ino.
export const BLE_SERVICE_UUID = "8c4db1e6-63ec-4d5b-9389-1d9b29d2f201";
export const BLE_READING_CHARACTERISTIC_UUID = "8c4db1e6-63ec-4d5b-9389-1d9b29d2f202";
