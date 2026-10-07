"""Consultas de solo lectura para los resúmenes de temperatura por minuto."""

import os
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv


HISTORY_COLUMNS = (
    "minute_utc, samples, ambient_min, ambient_max, ambient_avg, "
    "object_min, object_max, object_avg"
)
MAX_HISTORY_LIMIT = 5000


class TemperatureServiceError(Exception):
    """Base para errores controlados de la capa de consultas."""


class ConfigurationError(TemperatureServiceError):
    """La configuración necesaria para una consulta no es válida."""


class InvalidTimeRangeError(TemperatureServiceError):
    """Un rango o fecha recibidos no se pueden interpretar."""


class DatabaseTemporarilyUnavailableError(TemperatureServiceError):
    """SQLite está temporalmente bloqueada o no disponible."""


@dataclass(frozen=True)
class ServiceSettings:
    database_path: str
    local_timezone: str


@dataclass(frozen=True)
class NormalizedDateTime:
    local: datetime
    utc: datetime


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ConfigurationError(f"Falta la variable obligatoria {name}")
    return value.strip()


def load_settings() -> ServiceSettings:
    """Lee la configuración compartida sin exponerla en respuestas HTTP."""
    load_dotenv()
    local_timezone = required_env("LOCAL_TIMEZONE")
    try:
        ZoneInfo(local_timezone)
    except ZoneInfoNotFoundError as error:
        raise ConfigurationError("LOCAL_TIMEZONE no es una zona horaria válida") from error
    return ServiceSettings(
        database_path=required_env("DATABASE_PATH"),
        local_timezone=local_timezone,
    )


def classify_temperature(temp: float) -> str:
    """Clasificación de aplicación; no representa sensación térmica científica."""
    if temp < 18:
        return "frio"
    if temp < 24:
        return "templado"
    if temp < 28:
        return "calido"
    return "caluroso"


class TemperatureService:
    """Servicio sin estado que abre una conexión SQLite de solo lectura por consulta."""

    def __init__(self, database_path: str, local_timezone: str) -> None:
        self.database_path = Path(database_path)
        try:
            self.local_timezone = ZoneInfo(local_timezone)
        except ZoneInfoNotFoundError as error:
            raise ConfigurationError("LOCAL_TIMEZONE no es una zona horaria válida") from error

    @classmethod
    def from_environment(cls) -> "TemperatureService":
        settings = load_settings()
        return cls(settings.database_path, settings.local_timezone)

    def database_available(self) -> bool:
        """Comprueba disponibilidad sin crear ni modificar la base."""
        if not self.database_path.exists():
            return False
        try:
            with self._connect() as connection:
                connection.execute("SELECT 1 FROM temperature_minutes LIMIT 1")
            return True
        except (sqlite3.Error, OSError):
            return False

    def get_latest(self) -> Optional[dict[str, Any]]:
        rows = self._fetch_all(
            f"SELECT {HISTORY_COLUMNS} FROM temperature_minutes "
            "ORDER BY minute_utc DESC LIMIT 1"
        )
        if not rows:
            return None
        row = rows[0]
        return {
            "minute_utc": row["minute_utc"],
            "samples": row["samples"],
            "ambient": {
                "min": row["ambient_min"],
                "max": row["ambient_max"],
                "avg": row["ambient_avg"],
            },
            "object": {
                "min": row["object_min"],
                "max": row["object_max"],
                "avg": row["object_avg"],
            },
        }

    def get_stats(self, start: str, end: str) -> Optional[dict[str, Any]]:
        start_time = self._normalize_datetime(start)
        end_time = self._normalize_datetime(end)
        if start_time.utc >= end_time.utc:
            raise InvalidTimeRangeError("start debe ser anterior a end")

        row = self._fetch_one(
            """
            SELECT
                SUM(samples) AS samples,
                MIN(ambient_min) AS ambient_min,
                MAX(ambient_max) AS ambient_max,
                SUM(ambient_avg * samples) / SUM(samples) AS ambient_avg,
                MIN(object_min) AS object_min,
                MAX(object_max) AS object_max,
                SUM(object_avg * samples) / SUM(samples) AS object_avg
            FROM temperature_minutes
            WHERE minute_utc >= ? AND minute_utc < ?
            """,
            (self._minute_key(start_time.utc), self._minute_key(end_time.utc)),
        )
        if row is None or row["samples"] is None:
            return None

        ambient_avg = float(row["ambient_avg"])
        return {
            "period": self._period_payload(start_time, end_time),
            "samples": int(row["samples"]),
            "ambient": {
                "min": row["ambient_min"],
                "max": row["ambient_max"],
                "avg": ambient_avg,
            },
            "object": {
                "min": row["object_min"],
                "max": row["object_max"],
                "avg": float(row["object_avg"]),
            },
            "classification": classify_temperature(ambient_avg),
        }

    def get_history(self, start: str, end: str, limit: int = 500) -> list[dict[str, Any]]:
        if not 1 <= limit <= MAX_HISTORY_LIMIT:
            raise InvalidTimeRangeError(f"limit debe estar entre 1 y {MAX_HISTORY_LIMIT}")
        start_time = self._normalize_datetime(start)
        end_time = self._normalize_datetime(end)
        if start_time.utc >= end_time.utc:
            raise InvalidTimeRangeError("start debe ser anterior a end")

        rows = self._fetch_all(
            f"""
            SELECT {HISTORY_COLUMNS}
            FROM temperature_minutes
            WHERE minute_utc >= ? AND minute_utc < ?
            ORDER BY minute_utc DESC
            LIMIT ?
            """,
            (self._minute_key(start_time.utc), self._minute_key(end_time.utc), limit),
        )
        return [dict(row) for row in rows]

    def get_daily_summary(self, day: str) -> Optional[dict[str, Any]]:
        try:
            local_date = date.fromisoformat(day)
        except ValueError as error:
            raise InvalidTimeRangeError("date debe tener formato YYYY-MM-DD") from error

        start_local = datetime.combine(local_date, time.min, tzinfo=self.local_timezone)
        end_local = datetime.combine(local_date + timedelta(days=1), time.min, tzinfo=self.local_timezone)
        stats = self.get_stats(start_local.isoformat(), end_local.isoformat())
        if stats is None:
            return None
        stats["date_local"] = local_date.isoformat()
        return stats

    def _normalize_datetime(self, value: str) -> NormalizedDateTime:
        normalized_value = value.strip()
        if normalized_value.endswith("Z"):
            normalized_value = normalized_value[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(normalized_value)
        except ValueError as error:
            raise InvalidTimeRangeError("Fecha y hora inválidas; usa formato ISO 8601") from error

        local = (
            parsed.replace(tzinfo=self.local_timezone)
            if parsed.tzinfo is None
            else parsed.astimezone(self.local_timezone)
        )
        return NormalizedDateTime(local=local, utc=local.astimezone(timezone.utc))

    @staticmethod
    def _minute_key(value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M")

    @staticmethod
    def _period_payload(start: NormalizedDateTime, end: NormalizedDateTime) -> dict[str, str]:
        return {
            "start_local": start.local.isoformat(),
            "end_local": end.local.isoformat(),
            "start_utc": start.utc.isoformat(),
            "end_utc": end.utc.isoformat(),
        }

    def _connect(self) -> sqlite3.Connection:
        if not self.database_path.exists():
            raise FileNotFoundError
        uri = self.database_path.resolve().as_uri() + "?mode=ro"
        try:
            connection = sqlite3.connect(uri, uri=True, timeout=5)
        except sqlite3.OperationalError as error:
            if "locked" in str(error).lower():
                raise DatabaseTemporarilyUnavailableError from error
            raise
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _fetch_one(self, query: str, parameters: tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
        rows = self._fetch_all(query, parameters)
        return rows[0] if rows else None

    def _fetch_all(self, query: str, parameters: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        if not self.database_path.exists():
            return []
        try:
            with self._connect() as connection:
                return connection.execute(query, parameters).fetchall()
        except sqlite3.OperationalError as error:
            message = str(error).lower()
            if "locked" in message or "busy" in message:
                raise DatabaseTemporarilyUnavailableError from error
            if "no such table" in message:
                return []
            raise

