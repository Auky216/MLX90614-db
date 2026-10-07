"""Dashboard Streamlit de solo lectura para las mediciones MLX90614."""

import json
import logging
import math
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import paho.mqtt.client as mqtt
import plotly.graph_objects as go
import streamlit as st
from dotenv import load_dotenv


LOGGER = logging.getLogger(__name__)
HISTORY_COLUMNS = [
    "minute_utc",
    "samples",
    "ambient_min",
    "ambient_max",
    "ambient_avg",
    "object_min",
    "object_max",
    "object_avg",
]
FILTERS = {
    "Última hora": timedelta(hours=1),
    "Últimas 6 horas": timedelta(hours=6),
    "Últimas 24 horas": timedelta(hours=24),
    "Últimos 7 días": timedelta(days=7),
    "Todo": None,
}


@dataclass(frozen=True)
class DashboardSettings:
    mqtt_host: str
    mqtt_port: int
    mqtt_topic: str
    mqtt_client_id: str
    mqtt_username: Optional[str]
    mqtt_password: Optional[str]
    database_path: str


@dataclass(frozen=True)
class LiveReading:
    ambient: float
    object_temperature: float
    received_at: datetime


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ValueError(f"Falta la variable obligatoria {name} en .env")
    return value.strip()


def load_settings() -> DashboardSettings:
    load_dotenv()
    try:
        mqtt_port = int(required_env("MQTT_PORT"))
    except ValueError as error:
        raise ValueError("MQTT_PORT debe ser un número entero") from error
    if not 1 <= mqtt_port <= 65535:
        raise ValueError("MQTT_PORT debe estar entre 1 y 65535")

    return DashboardSettings(
        mqtt_host=required_env("MQTT_HOST"),
        mqtt_port=mqtt_port,
        mqtt_topic=required_env("MQTT_TOPIC"),
        mqtt_client_id=required_env("MQTT_DASHBOARD_CLIENT_ID"),
        mqtt_username=os.getenv("MQTT_USERNAME") or None,
        mqtt_password=os.getenv("MQTT_PASSWORD") or None,
        database_path=required_env("DATABASE_PATH"),
    )


def parse_temperature_message(message: mqtt.MQTTMessage, expected_topic: str) -> tuple[float, float]:
    if message.topic != expected_topic:
        raise ValueError(f"topic inesperado: {message.topic!r}")
    try:
        payload = message.payload.decode("utf-8")
        data = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
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


class MqttMonitor:
    """Cliente MQTT en segundo plano con un estado seguro para Streamlit."""

    def __init__(self, settings: DashboardSettings) -> None:
        self.settings = settings
        self.lock = threading.Lock()
        self.connected = False
        self.latest_reading: Optional[LiveReading] = None
        self.last_error: Optional[str] = None
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=settings.mqtt_client_id,
        )
        self.client.reconnect_delay_set(min_delay=1, max_delay=60)
        if settings.mqtt_username:
            self.client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        self.client.on_connect = self._on_connect
        self.client.on_connect_fail = self._on_connect_fail
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def start(self) -> None:
        self.client.connect_async(
            self.settings.mqtt_host,
            self.settings.mqtt_port,
            keepalive=60,
        )
        self.client.loop_start()

    def snapshot(self) -> tuple[bool, Optional[LiveReading], Optional[str]]:
        with self.lock:
            return self.connected, self.latest_reading, self.last_error

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: object,
        flags: object,
        reason_code: object,
        properties: object,
    ) -> None:
        if getattr(reason_code, "is_failure", False):
            with self.lock:
                self.connected = False
                self.last_error = f"MQTT rechazó la conexión: {reason_code}"
            return

        result, _ = client.subscribe(self.settings.mqtt_topic)
        with self.lock:
            self.connected = result == mqtt.MQTT_ERR_SUCCESS
            self.last_error = None if self.connected else f"No se pudo suscribir: código {result}"
        if result == mqtt.MQTT_ERR_SUCCESS:
            LOGGER.info("MQTT conectado y suscrito a %s", self.settings.mqtt_topic)
        else:
            LOGGER.warning("No se pudo suscribir a %s: código %s", self.settings.mqtt_topic, result)

    def _on_connect_fail(self, client: mqtt.Client, userdata: object) -> None:
        with self.lock:
            self.connected = False
            self.last_error = "No se pudo conectar a MQTT"

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: object,
        disconnect_flags: object,
        reason_code: object,
        properties: object,
    ) -> None:
        with self.lock:
            self.connected = False
            if reason_code != 0:
                self.last_error = f"MQTT desconectado: {reason_code}"

    def _on_message(self, client: mqtt.Client, userdata: object, message: mqtt.MQTTMessage) -> None:
        try:
            ambient, object_temperature = parse_temperature_message(message, self.settings.mqtt_topic)
        except ValueError as error:
            LOGGER.warning("Mensaje MQTT ignorado: %s", error)
            return

        reading = LiveReading(
            ambient=ambient,
            object_temperature=object_temperature,
            received_at=datetime.now(timezone.utc),
        )
        with self.lock:
            self.latest_reading = reading
        LOGGER.info("Lectura MQTT recibida: ambiente=%.2f objeto=%.2f", ambient, object_temperature)


@st.cache_resource(show_spinner=False)
def get_mqtt_monitor(settings: DashboardSettings) -> MqttMonitor:
    monitor = MqttMonitor(settings)
    monitor.start()
    return monitor


def empty_history() -> pd.DataFrame:
    return pd.DataFrame(columns=HISTORY_COLUMNS)


def read_history(
    database_path: str,
    window: Optional[timedelta],
    limit: Optional[int] = None,
) -> tuple[pd.DataFrame, Optional[str]]:
    """Lee SQLite con conexiones de corta duración y sin modificar datos."""
    path = Path(database_path)
    if not path.exists():
        return empty_history(), None

    query = f"SELECT {', '.join(HISTORY_COLUMNS)} FROM temperature_minutes"
    parameters: list[object] = []
    if window is not None:
        cutoff = datetime.now(timezone.utc) - window
        query += " WHERE minute_utc >= ?"
        parameters.append(cutoff.strftime("%Y-%m-%d %H:%M"))
    query += " ORDER BY minute_utc DESC"
    if limit is not None:
        query += " LIMIT ?"
        parameters.append(limit)

    for attempt in range(3):
        try:
            uri = path.resolve().as_uri() + "?mode=ro"
            with sqlite3.connect(uri, uri=True, timeout=1) as connection:
                connection.execute("PRAGMA busy_timeout = 1000")
                return pd.read_sql_query(query, connection, params=parameters), None
        except sqlite3.OperationalError as error:
            if "no such table" in str(error).lower():
                return empty_history(), None
            if "locked" in str(error).lower() and attempt < 2:
                time.sleep(0.2 * (attempt + 1))
                continue
            return empty_history(), f"No se pudo leer SQLite: {error}"
        except sqlite3.Error as error:
            return empty_history(), f"No se pudo leer SQLite: {error}"

    return empty_history(), "No se pudo leer SQLite temporalmente."


def format_temperature(value: Optional[float]) -> str:
    return "—" if value is None else f"{value:.2f} °C"


def render_average_chart(history: pd.DataFrame) -> None:
    chart_data = history.sort_values("minute_utc")
    figure = go.Figure()
    figure.add_trace(go.Scatter(
        x=chart_data["minute_utc"], y=chart_data["ambient_avg"],
        mode="lines+markers", name="Ambiente promedio",
    ))
    figure.add_trace(go.Scatter(
        x=chart_data["minute_utc"], y=chart_data["object_avg"],
        mode="lines+markers", name="Objeto promedio",
    ))
    figure.update_layout(
        title="Temperaturas promedio por minuto",
        xaxis_title="Minuto UTC",
        yaxis_title="Temperatura (°C)",
        legend_title="Serie",
    )
    st.plotly_chart(figure, use_container_width=True)


def render_minmax_chart(history: pd.DataFrame) -> None:
    chart_data = history.sort_values("minute_utc")
    figure = go.Figure()
    for column, label in (
        ("ambient_min", "Ambiente mínima"),
        ("ambient_max", "Ambiente máxima"),
        ("object_min", "Objeto mínima"),
        ("object_max", "Objeto máxima"),
    ):
        figure.add_trace(go.Scatter(
            x=chart_data["minute_utc"], y=chart_data[column],
            mode="lines", name=label,
        ))
    figure.update_layout(
        title="Temperaturas mínima y máxima por minuto",
        xaxis_title="Minuto UTC",
        yaxis_title="Temperatura (°C)",
        legend_title="Serie",
    )
    st.plotly_chart(figure, use_container_width=True)


@st.fragment(run_every="2s")
def render_dashboard(settings: DashboardSettings) -> None:
    monitor = get_mqtt_monitor(settings)
    connected, reading, mqtt_error = monitor.snapshot()

    st.subheader("Estado en tiempo real")
    if connected:
        st.success("MQTT: 🟢 Conectado")
    else:
        st.warning("MQTT: 🔴 Desconectado")
        if mqtt_error:
            st.caption(mqtt_error)

    filter_label = st.selectbox("Histórico", list(FILTERS), key="history_window")
    history, database_error = read_history(settings.database_path, FILTERS[filter_label])
    latest_history, latest_error = read_history(settings.database_path, None, limit=1)
    if database_error:
        st.warning(database_error)
    if latest_error:
        st.warning(latest_error)

    latest_minute = latest_history.iloc[0] if not latest_history.empty else None
    row_one = st.columns(3)
    row_one[0].metric("Temperatura ambiente", format_temperature(reading.ambient if reading else None))
    row_one[1].metric("Temperatura objeto", format_temperature(reading.object_temperature if reading else None))
    row_one[2].metric(
        "Última lectura",
        reading.received_at.strftime("%Y-%m-%d %H:%M:%S UTC") if reading else "Sin lecturas",
    )

    row_two = st.columns(3)
    row_two[0].metric(
        "Último promedio ambiente",
        format_temperature(float(latest_minute["ambient_avg"])) if latest_minute is not None else "—",
    )
    row_two[1].metric(
        "Último promedio objeto",
        format_temperature(float(latest_minute["object_avg"])) if latest_minute is not None else "—",
    )
    row_two[2].metric(
        "Muestras último minuto",
        str(int(latest_minute["samples"])) if latest_minute is not None else "—",
    )

    row_three = st.columns(2)
    row_three[0].metric(
        "Ambiente mín/máx",
        (
            f"{float(latest_minute['ambient_min']):.2f} / {float(latest_minute['ambient_max']):.2f} °C"
            if latest_minute is not None else "—"
        ),
    )
    row_three[1].metric(
        "Objeto mín/máx",
        (
            f"{float(latest_minute['object_min']):.2f} / {float(latest_minute['object_max']):.2f} °C"
            if latest_minute is not None else "—"
        ),
    )

    st.divider()
    st.subheader("Histórico")
    if history.empty:
        st.info("Aún no hay datos históricos.")
        return

    render_average_chart(history)
    if st.checkbox("Mostrar gráfico de mínimas y máximas", value=True, key="show_minmax"):
        render_minmax_chart(history)

    st.subheader("Últimas mediciones por minuto")
    st.dataframe(history[HISTORY_COLUMNS], hide_index=True, use_container_width=True)


def main() -> None:
    st.set_page_config(page_title="MLX90614 Monitor", page_icon="🌡️", layout="wide")
    st.title("MLX90614 Monitor")
    st.caption("Lecturas instantáneas por MQTT e histórico agregado por minuto UTC.")
    try:
        settings = load_settings()
    except ValueError as error:
        st.error(f"Error de configuración: {error}")
        st.stop()
    render_dashboard(settings)


if __name__ == "__main__":
    main()
