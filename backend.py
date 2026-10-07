"""Consume lecturas MLX90614 desde MQTT y guarda resúmenes por minuto en SQLite."""

import json
import math
import os
import signal
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt
from dotenv import load_dotenv


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS temperature_minutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    minute_utc TEXT NOT NULL UNIQUE,
    samples INTEGER NOT NULL,
    ambient_min REAL NOT NULL,
    ambient_max REAL NOT NULL,
    ambient_avg REAL NOT NULL,
    object_min REAL NOT NULL,
    object_max REAL NOT NULL,
    object_avg REAL NOT NULL,
    created_at TEXT NOT NULL
)
"""


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    mqtt_topic: str
    mqtt_client_id: str
    mqtt_username: Optional[str]
    mqtt_password: Optional[str]
    database_path: str


@dataclass(frozen=True)
class MinuteSummary:
    minute_utc: str
    samples: int
    ambient_min: float
    ambient_max: float
    ambient_avg: float
    object_min: float
    object_max: float
    object_avg: float


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ValueError(f"Falta la variable obligatoria {name} en .env")
    return value.strip()


def load_settings() -> Settings:
    """Carga toda la configuración de .env y valida lo necesario para iniciar."""
    load_dotenv()
    port_text = required_env("MQTT_PORT")
    try:
        mqtt_port = int(port_text)
    except ValueError as error:
        raise ValueError("MQTT_PORT debe ser un número entero") from error
    if not 1 <= mqtt_port <= 65535:
        raise ValueError("MQTT_PORT debe estar entre 1 y 65535")

    return Settings(
        mqtt_host=required_env("MQTT_HOST"),
        mqtt_port=mqtt_port,
        mqtt_topic=required_env("MQTT_TOPIC"),
        mqtt_client_id=required_env("MQTT_CLIENT_ID"),
        mqtt_username=os.getenv("MQTT_USERNAME") or None,
        mqtt_password=os.getenv("MQTT_PASSWORD") or None,
        database_path=required_env("DATABASE_PATH"),
    )


class Database:
    """Conexión SQLite que puede recuperarse de errores temporales."""

    def __init__(self, database_path: str) -> None:
        self.database_path = database_path
        self.connection: Optional[sqlite3.Connection] = None
        self.next_retry_at = 0.0

    def _connect(self) -> sqlite3.Connection:
        if self.connection is not None:
            return self.connection
        database_file = Path(self.database_path)
        if database_file.parent != Path("."):
            database_file.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=5, check_same_thread=False)
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute(CREATE_TABLE_SQL)
        connection.commit()
        self.connection = connection
        return connection

    def ensure_ready(self) -> bool:
        try:
            self._connect()
            return True
        except (sqlite3.Error, OSError) as error:
            self._handle_error(error)
            return False

    def save_summary(self, summary: MinuteSummary) -> bool:
        """Inserta el resumen o lo combina si el proceso se reinició ese minuto."""
        if time.monotonic() < self.next_retry_at:
            return False
        try:
            connection = self._connect()
            connection.execute(
                """
                INSERT INTO temperature_minutes (
                    minute_utc, samples,
                    ambient_min, ambient_max, ambient_avg,
                    object_min, object_max, object_avg, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(minute_utc) DO UPDATE SET
                    samples = temperature_minutes.samples + excluded.samples,
                    ambient_min = MIN(temperature_minutes.ambient_min, excluded.ambient_min),
                    ambient_max = MAX(temperature_minutes.ambient_max, excluded.ambient_max),
                    ambient_avg = (
                        temperature_minutes.ambient_avg * temperature_minutes.samples
                        + excluded.ambient_avg * excluded.samples
                    ) / (temperature_minutes.samples + excluded.samples),
                    object_min = MIN(temperature_minutes.object_min, excluded.object_min),
                    object_max = MAX(temperature_minutes.object_max, excluded.object_max),
                    object_avg = (
                        temperature_minutes.object_avg * temperature_minutes.samples
                        + excluded.object_avg * excluded.samples
                    ) / (temperature_minutes.samples + excluded.samples)
                """,
                (
                    summary.minute_utc, summary.samples,
                    summary.ambient_min, summary.ambient_max, summary.ambient_avg,
                    summary.object_min, summary.object_max, summary.object_avg,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            connection.commit()
            return True
        except (sqlite3.Error, OSError) as error:
            if self.connection is not None:
                try:
                    self.connection.rollback()
                except sqlite3.Error:
                    pass
            self._handle_error(error)
            return False

    def _handle_error(self, error: Exception) -> None:
        print(f"Error de SQLite: {error}. Se reintentará en 5 segundos.")
        self.close()
        self.next_retry_at = time.monotonic() + 5

    def close(self) -> None:
        if self.connection is not None:
            try:
                self.connection.close()
            except sqlite3.Error as error:
                print(f"Error al cerrar SQLite: {error}")
            finally:
                self.connection = None


class MinuteAccumulator:
    """Agrupa muestras UTC en memoria y entrega un resumen terminado por minuto."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.current_minute: Optional[datetime] = None
        self.samples = 0
        self.ambient_sum = 0.0
        self.ambient_min: Optional[float] = None
        self.ambient_max: Optional[float] = None
        self.object_sum = 0.0
        self.object_min: Optional[float] = None
        self.object_max: Optional[float] = None
        self.pending: list[MinuteSummary] = []

    def add(self, ambient: float, object_temperature: float, observed_at: datetime) -> None:
        minute = observed_at.replace(second=0, microsecond=0)
        with self.lock:
            if self.current_minute is None:
                self._reset(minute)
            elif minute != self.current_minute:
                self._queue_current()
                self._reset(minute)
            self.samples += 1
            self.ambient_sum += ambient
            self.object_sum += object_temperature
            self.ambient_min = ambient if self.ambient_min is None else min(self.ambient_min, ambient)
            self.ambient_max = ambient if self.ambient_max is None else max(self.ambient_max, ambient)
            self.object_min = object_temperature if self.object_min is None else min(self.object_min, object_temperature)
            self.object_max = object_temperature if self.object_max is None else max(self.object_max, object_temperature)

    def finish_expired(self, now: datetime) -> None:
        with self.lock:
            if self.current_minute is not None and now >= self.current_minute + timedelta(minutes=1):
                self._queue_current()
                self._reset(None)

    def finish_current(self) -> None:
        with self.lock:
            self._queue_current()
            self._reset(None)

    def take_pending(self) -> list[MinuteSummary]:
        with self.lock:
            pending, self.pending = self.pending, []
            return pending

    def restore_pending(self, summaries: list[MinuteSummary]) -> None:
        with self.lock:
            self.pending = summaries + self.pending

    def _queue_current(self) -> None:
        if self.current_minute is None or self.samples == 0:
            return
        assert self.ambient_min is not None and self.ambient_max is not None
        assert self.object_min is not None and self.object_max is not None
        self.pending.append(MinuteSummary(
            minute_utc=self.current_minute.strftime("%Y-%m-%d %H:%M"),
            samples=self.samples,
            ambient_min=self.ambient_min,
            ambient_max=self.ambient_max,
            ambient_avg=self.ambient_sum / self.samples,
            object_min=self.object_min,
            object_max=self.object_max,
            object_avg=self.object_sum / self.samples,
        ))

    def _reset(self, minute: Optional[datetime]) -> None:
        self.current_minute = minute
        self.samples = 0
        self.ambient_sum = 0.0
        self.ambient_min = None
        self.ambient_max = None
        self.object_sum = 0.0
        self.object_min = None
        self.object_max = None


def print_saved(summary: MinuteSummary) -> None:
    print("\n===================================")
    print("MINUTO GUARDADO")
    print("===================================")
    print(f"Minuto UTC: {summary.minute_utc}")
    print(f"Muestras: {summary.samples}")
    print(f"Ambiente: min={summary.ambient_min:.2f} max={summary.ambient_max:.2f} avg={summary.ambient_avg:.2f}")
    print(f"Objeto: min={summary.object_min:.2f} max={summary.object_max:.2f} avg={summary.object_avg:.2f}")
    print("===================================\n")


def flush_pending(accumulator: MinuteAccumulator, database: Database) -> None:
    summaries = accumulator.take_pending()
    for index, summary in enumerate(summaries):
        if database.save_summary(summary):
            print_saved(summary)
        else:
            accumulator.restore_pending(summaries[index:])
            return


def parse_temperature_message(message: mqtt.MQTTMessage, expected_topic: str) -> tuple[float, float]:
    if message.topic != expected_topic:
        raise ValueError(f"topic inesperado: {message.topic!r}")
    try:
        payload = message.payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("payload no es UTF-8") from error
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as error:
        raise ValueError("JSON inválido") from error
    if not isinstance(data, dict):
        raise ValueError("el JSON debe ser un objeto")
    if "ambient" not in data or "object" not in data:
        raise ValueError("faltan los campos ambient y/o object")
    if isinstance(data["ambient"], bool) or isinstance(data["object"], bool):
        raise ValueError("ambient y object deben ser números")
    try:
        ambient = float(data["ambient"])
        object_temperature = float(data["object"])
    except (TypeError, ValueError) as error:
        raise ValueError("ambient y object deben ser números") from error
    if not math.isfinite(ambient) or not math.isfinite(object_temperature):
        raise ValueError("ambient y object deben ser números finitos")
    return ambient, object_temperature


def main() -> None:
    try:
        settings = load_settings()
    except ValueError as error:
        print(f"Error de configuración: {error}")
        return

    database = Database(settings.database_path)
    database.ensure_ready()
    accumulator = MinuteAccumulator()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=settings.mqtt_client_id)
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    if settings.mqtt_username:
        client.username_pw_set(settings.mqtt_username, settings.mqtt_password)

    def on_connect(client: mqtt.Client, userdata: object, flags: object, reason_code: object, properties: object) -> None:
        if getattr(reason_code, "is_failure", False):
            print(f"MQTT rechazó la conexión: {reason_code}")
            return
        result, _ = client.subscribe(settings.mqtt_topic)
        if result == mqtt.MQTT_ERR_SUCCESS:
            print(f"MQTT conectado a {settings.mqtt_host}:{settings.mqtt_port}")
            print(f"Escuchando: {settings.mqtt_topic}")
        else:
            print(f"Error al suscribirse a {settings.mqtt_topic}: código {result}")

    def on_connect_fail(client: mqtt.Client, userdata: object) -> None:
        print("No se pudo conectar a MQTT. Se reintentará automáticamente.")

    def on_disconnect(client: mqtt.Client, userdata: object, disconnect_flags: object, reason_code: object, properties: object) -> None:
        if reason_code != 0:
            sent_by_server = getattr(disconnect_flags, "is_disconnect_packet_from_server", False)
            origin = (
                "Mosquitto envió un paquete DISCONNECT"
                if sent_by_server
                else "la conexión TCP se cerró sin un paquete MQTT DISCONNECT"
            )
            print(
                f"MQTT desconectado ({reason_code}): {origin}. "
                "Se reintentará automáticamente."
            )

    def on_message(client: mqtt.Client, userdata: object, message: mqtt.MQTTMessage) -> None:
        try:
            ambient, object_temperature = parse_temperature_message(message, settings.mqtt_topic)
        except ValueError as error:
            print(f"Mensaje MQTT ignorado: {error}")
            return
        now = datetime.now(timezone.utc)
        print(f"{now.strftime('%H:%M:%S')} | Ambiente: {ambient:.2f} C | Objeto: {object_temperature:.2f} C")
        accumulator.add(ambient, object_temperature, now)

    client.on_connect = on_connect
    client.on_connect_fail = on_connect_fail
    client.on_disconnect = on_disconnect
    client.on_message = on_message

    stop_requested = threading.Event()

    def request_shutdown(signum: int, frame: object) -> None:
        if not stop_requested.is_set():
            print(f"\nSeñal {signal.Signals(signum).name} recibida. Cerrando backend...")
        stop_requested.set()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)

    print("\n===================================")
    print("MLX90614 BACKEND")
    print("===================================")
    print(f"MQTT: {settings.mqtt_host}:{settings.mqtt_port}")
    print(f"Topic: {settings.mqtt_topic}")
    print(f"Database: {settings.database_path}")
    print("===================================\n")

    client.connect_async(settings.mqtt_host, settings.mqtt_port, keepalive=60)
    client.loop_start()
    try:
        while not stop_requested.is_set():
            accumulator.finish_expired(datetime.now(timezone.utc))
            flush_pending(accumulator, database)
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nCerrando backend...")
        stop_requested.set()
    finally:
        client.disconnect()
        client.loop_stop()
        accumulator.finish_current()
        flush_pending(accumulator, database)
        database.close()


if __name__ == "__main__":
    main()
