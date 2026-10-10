"""Ingreso autenticado e idempotente de lecturas originadas en la app móvil."""

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from dotenv import load_dotenv


class MobileIngestionError(Exception):
    """Error controlado durante la persistencia móvil."""


class MobileIngestionConfigurationError(MobileIngestionError):
    """Falta configuración obligatoria."""


class MobileIngestionUnavailableError(MobileIngestionError):
    """SQLite está ocupada temporalmente."""


@dataclass(frozen=True)
class MobileReading:
    source_id: str
    captured_at_utc: str
    ambient: float
    object: float
    sequence: int | None


@dataclass(frozen=True)
class MobileMinute:
    """Resumen completo de un minuto calculado en el iPhone."""

    minute_utc: str
    samples: int
    ambient_min: float
    ambient_max: float
    ambient_avg: float
    object_min: float
    object_max: float
    object_avg: float


def load_mobile_sync_token() -> str:
    load_dotenv()
    token = os.getenv("MOBILE_SYNC_TOKEN", "").strip()
    if not token:
        raise MobileIngestionConfigurationError("MOBILE_SYNC_TOKEN no está configurado")
    return token


def load_database_path() -> Path:
    load_dotenv()
    value = os.getenv("DATABASE_PATH", "").strip()
    if not value:
        raise MobileIngestionConfigurationError("DATABASE_PATH no está configurado")
    return Path(value)


class MobileIngestionService:
    """Escribe exclusivamente en una tabla independiente de las lecturas MQTT."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    @classmethod
    def from_environment(cls) -> "MobileIngestionService":
        return cls(load_database_path())

    def store_batch(self, device_id: str, readings: Iterable[MobileReading]) -> list[str]:
        records = list(readings)
        if not records:
            return []
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self._connect() as connection:
                self._create_table(connection)
                connection.executemany(
                    """
                    INSERT OR IGNORE INTO mobile_temperature_readings
                    (source_id, device_id, captured_at_utc, ambient, object, sequence, received_at_utc)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            reading.source_id,
                            device_id,
                            reading.captured_at_utc,
                            reading.ambient,
                            reading.object,
                            reading.sequence,
                            datetime.now(timezone.utc).isoformat(),
                        )
                        for reading in records
                    ],
                )
            # Una fila preexistente con el mismo source_id ya fue recibida: también es confirmada.
            return [reading.source_id for reading in records]
        except sqlite3.OperationalError as error:
            if "locked" in str(error).lower() or "busy" in str(error).lower():
                raise MobileIngestionUnavailableError from error
            raise MobileIngestionError("No se pudo guardar el lote móvil") from error

    def store_minute_batch(self, device_id: str, minutes: Iterable[MobileMinute]) -> list[str]:
        """Guarda resúmenes por minuto de forma idempotente y sin tocar MQTT."""
        records = list(minutes)
        if not records:
            return []
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self._connect() as connection:
                self._create_minute_table(connection)
                connection.executemany(
                    """
                    INSERT OR IGNORE INTO mobile_temperature_minutes
                    (device_id, minute_utc, samples, ambient_min, ambient_max, ambient_avg,
                     object_min, object_max, object_avg, received_at_utc)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            device_id,
                            minute.minute_utc,
                            minute.samples,
                            minute.ambient_min,
                            minute.ambient_max,
                            minute.ambient_avg,
                            minute.object_min,
                            minute.object_max,
                            minute.object_avg,
                            datetime.now(timezone.utc).isoformat(),
                        )
                        for minute in records
                    ],
                )
            return [minute.minute_utc for minute in records]
        except sqlite3.OperationalError as error:
            if "locked" in str(error).lower() or "busy" in str(error).lower():
                raise MobileIngestionUnavailableError from error
            raise MobileIngestionError("No se pudo guardar el resumen móvil") from error

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @staticmethod
    def _create_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS mobile_temperature_readings (
                source_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                ambient REAL NOT NULL,
                object REAL NOT NULL,
                sequence INTEGER,
                received_at_utc TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS mobile_temperature_readings_captured_idx "
            "ON mobile_temperature_readings(captured_at_utc DESC)"
        )

    @staticmethod
    def _create_minute_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS mobile_temperature_minutes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                minute_utc TEXT NOT NULL,
                samples INTEGER NOT NULL,
                ambient_min REAL NOT NULL,
                ambient_max REAL NOT NULL,
                ambient_avg REAL NOT NULL,
                object_min REAL NOT NULL,
                object_max REAL NOT NULL,
                object_avg REAL NOT NULL,
                received_at_utc TEXT NOT NULL,
                UNIQUE(device_id, minute_utc)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS mobile_temperature_minutes_minute_idx "
            "ON mobile_temperature_minutes(minute_utc DESC)"
        )
