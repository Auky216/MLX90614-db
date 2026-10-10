# ThermaSense para iPhone

Aplicación React Native independiente del backend Python. Recibe lecturas por Bluetooth Low Energy (BLE), las conserva en SQLite en el iPhone y solo las sube cuando la persona pulsa el botón **Subir datos**.

## Principios

- El ESP32 publica por BLE; Mosquitto no participa en la captura móvil.
- SQLite es la fuente de datos local del iPhone.
- La app no contiene claves de DeepSeek ni tokens de servidor en archivos `EXPO_PUBLIC_*`.
- La app sincroniza automáticamente resúmenes cerrados por minuto, de forma idempotente.

## Preparación

Necesitas macOS, Xcode, una cuenta de Apple configurada para desarrollo y tu iPhone con modo de desarrollador activado. BLE y el asistente local requieren una compilación nativa; Expo Go no sirve para esta app.

```bash
cd mobile
npm install
npx expo install --fix
cp .env.example .env
npx expo prebuild --clean
npx expo run:ios --device --configuration Release
```

Esto instala una aplicación directa con el código JavaScript incluido: al abrirla no busca Metro, Expo Go ni un servidor de desarrollo. La app usa `@sfourdrinier/react-native-ble-plx` para BLE y el módulo nativo `mlx-local-ai` para Apple Intelligence local.

Solo durante desarrollo, después de cambiar TypeScript o la interfaz, puedes crear e instalar de nuevo la versión directa:

```bash
npx expo run:ios --device --configuration Release
```

## ESP32

Carga [firmware/esp32_mlx90614_ble.ino](firmware/esp32_mlx90614_ble.ino) con Arduino IDE. El firmware anuncia `MLX90614-ESP32` y envía notificaciones JSON cada segundo mediante la característica BLE definida en `src/config/ble.ts`.

## Datos locales

La base `mlx90614-mobile.db` se administra mediante `expo-sqlite` y contiene:

- `readings`: cada lectura recibida por BLE.
- `minute_summaries`: min, max, promedio y muestras por minuto UTC.
- `chat_messages`: historial de la interfaz de chat.

## Sincronización

Configura `EXPO_PUBLIC_SYNC_BASE_URL` con la URL de tu API. El token no se agrega a `.env`: se ingresa dentro de Ajustes y queda en el llavero de iOS mediante `expo-secure-store`.

El servidor recibe `POST /mobile/v1/minutes/batch`, incluye autenticación `X-MLX-Sync-Token` y acepta hasta 500 minutos por lote. La app conserva los minutos pendientes cuando falla la red, los reintenta cada 30 segundos mientras está abierta y muestra la hora del último envío confirmado. El minuto actual nunca se sube hasta cerrarse.

## Asistente IA

La pestaña **Asistente** conserva sus conversaciones en SQLite y no conecta con la Mac ni con un servidor. En un iPhone compatible con Apple Intelligence e iOS 26 o posterior usa Apple Foundation Models dentro del dispositivo para responder sobre los datos locales. Si el modelo no está disponible, la app ofrece un resumen local calculado desde SQLite.

Para una prueba directa con DeepSeek, agrega estas variables a `mobile/.env` y vuelve a compilar la app:

```env
EXPO_PUBLIC_DEEPSEEK_API_KEY=tu_clave_deepseek
EXPO_PUBLIC_DEEPSEEK_MODEL=deepseek-chat
EXPO_PUBLIC_TEMPERATURE_API_BASE_URL=http://tu-servidor:8001
```

La app envía la pregunta a DeepSeek y ejecuta solo las herramientas GET permitidas de la API histórica (`latest`, `stats`, `history` y `daily-summary`). Es una configuración de prueba: el prefijo `EXPO_PUBLIC_` incorpora la clave a la aplicación compilada. No la uses en una aplicación distribuida.

## Diseño e ilustraciones

La interfaz usa una paleta estrictamente negra y blanca, `NativeWind` y una configuración `components.json` compatible con el enfoque de React Native Reusables, el equivalente móvil de shadcn/ui. Las ilustraciones son SVG monocromáticos locales para que la aplicación funcione sin red. Antes de publicar, reemplázalas por SVG descargados y conservados localmente desde [unDraw](https://undraw.co/illustrations), verificando su licencia.
