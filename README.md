# MLX90614 Monitor

Proyecto Python para recibir lecturas MLX90614 por MQTT, guardarlas agregadas por minuto UTC en SQLite y visualizarlas en un dashboard Streamlit.

## Arquitectura

```text
ESP32 + MLX90614
        |
        | MQTT: MLX90614/temperature
        v
Mosquitto del host Linux :1883
        |
        +--> Contenedor mlx90614-backend
        |       |
        |       v
        |   SQLite persistente: ./data/mlx90614.db
        |
        +--> Contenedor mlx90614-dashboard
                |
                v
            Dashboard Streamlit
```

Mosquitto no forma parte de Docker Compose. Debe ejecutarse como servicio del host Linux. El backend es el único proceso que escribe SQLite: el dashboard se suscribe a MQTT para las lecturas instantáneas y solo lee el histórico agregado.

Los mensajes MQTT deben tener este formato:

```json
{"ambient": 28.31, "object": 27.85}
```

## Desarrollo local

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python backend.py
```

En otra terminal, con el mismo entorno virtual activo:

```bash
streamlit run dashboard.py
```

Edita `.env` con las credenciales, hosts e IDs MQTT de tu entorno. No se versiona. `MQTT_CLIENT_ID` y `MQTT_DASHBOARD_CLIENT_ID` deben ser distintos.

## Levantar servicios en Linux

```bash
git clone <repository-url>
cd MLX90614-db
cp .env.example .env
nano .env
docker compose up -d --build
```

`compose.yaml` usa `network_mode: host`, pensado para Docker en Linux. Así, `MQTT_HOST=127.0.0.1` desde ambos contenedores llega a Mosquitto ejecutándose en el host Linux por el puerto 1883. No se publican puertos Docker.

Por defecto Streamlit escucha en `DASHBOARD_HOST=127.0.0.1`, de modo que no queda expuesto públicamente. Si más adelante instalas Nginx o un reverse proxy, cambia conscientemente esta variable a `0.0.0.0` y aplica las reglas de acceso del proxy. No uses esta configuración de red como sustituto de la configuración de host en Docker Desktop para macOS o Windows.

## Estado y logs

Estado de ambos servicios:

```bash
docker compose ps
```

Logs del backend:

```bash
docker compose logs -f mlx90614-backend
```

Logs del dashboard:

```bash
docker compose logs -f mlx90614-dashboard
```

## Acceso seguro al dashboard

Desde tu Mac, crea un túnel SSH hacia el puerto local del servidor:

```bash
ssh -L 8501:127.0.0.1:8501 programador@13.140.187.142
```

Después abre [http://localhost:8501](http://localhost:8501).

## Operación

Detener los servicios:

```bash
docker compose down
```

Actualizar desde GitHub:

```bash
git pull
docker compose up -d --build
```

## Verificar SQLite

La base persistente se encuentra en `data/mlx90614.db`. Si `sqlite3` está instalado en el servidor:

```bash
sqlite3 data/mlx90614.db
SELECT * FROM temperature_minutes ORDER BY id DESC LIMIT 10;
```

## Prueba MQTT

Publica una lectura de prueba desde el servidor Linux:

```bash
mosquitto_pub \
  -h 127.0.0.1 \
  -p 1883 \
  -t 'MLX90614/temperature' \
  -m '{"ambient":28.31,"object":27.85}'
```

Comprueba que ambos procesos reciban la lectura con:

```bash
docker compose logs -f mlx90614-backend mlx90614-dashboard
```
