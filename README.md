# MLX90614 MQTT backend

Backend Python que recibe mediciones MLX90614 desde MQTT y guarda un resumen por minuto UTC en SQLite.

## Arquitectura

```text
ESP32 + MLX90614
        |
        | MQTT
        v
Mosquitto del host Linux :1883
        |
        v
Contenedor Docker: MLX90614 backend
        |
        v
SQLite persistente: ./data/mlx90614.db
```

Mosquitto no forma parte de este proyecto ni de Docker Compose. Debe ejecutarse como servicio en el servidor Linux y publicar en `MLX90614/temperature` mensajes como:

```json
{"ambient": 28.31, "object": 27.85}
```

El backend muestra cada lectura en stdout y guarda una fila por minuto UTC con número de muestras, mínimo, máximo y promedio de ambas temperaturas. Al recibir `SIGTERM` o `Ctrl+C`, guarda el minuto en curso antes de cerrar SQLite.

## Desarrollo local

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python backend.py
```

Edita `.env` con el host, las credenciales y el identificador MQTT que correspondan a tu entorno. `.env` no se versiona.

## Deployment en el servidor Linux

```bash
git clone <repository-url>
cd MLX90614-db
cp .env.example .env
nano .env
docker compose up -d --build
```

`compose.yaml` usa `network_mode: host`, pensado para Docker en Linux. Por ello, `MQTT_HOST=127.0.0.1` dentro del contenedor alcanza al Mosquitto que escucha en el host Linux por el puerto 1883. No se publican puertos porque el backend no ofrece una API HTTP.

No uses este modo de red como sustituto de configuración de host en Docker Desktop para macOS o Windows.

## Operación

Ver el estado:

```bash
docker compose ps
```

Ver los logs:

```bash
docker compose logs -f mlx90614-backend
```

Reiniciar el backend:

```bash
docker compose restart mlx90614-backend
```

Detenerlo:

```bash
docker compose down
```

Actualizar desde GitHub:

```bash
git pull
docker compose up -d --build
```

## Verificar SQLite

La base persistente queda en `data/mlx90614.db`. Si `sqlite3` está instalado en el servidor:

```bash
sqlite3 data/mlx90614.db
SELECT * FROM temperature_minutes ORDER BY id DESC LIMIT 10;
```

## Prueba MQTT

Con Mosquitto ejecutándose en el servidor, publica una lectura de prueba:

```bash
mosquitto_pub \
  -h localhost \
  -p 1883 \
  -t 'MLX90614/temperature' \
  -m '{"ambient":28.69,"object":25.85}'
```

Comprueba la recepción y el resumen de minuto con:

```bash
docker compose logs -f mlx90614-backend
```
