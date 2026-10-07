import sqlite3
from pathlib import Path

import pytest

from temperature_service import InvalidTimeRangeError, TemperatureService, classify_temperature


SCHEMA = """
CREATE TABLE temperature_minutes (
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


@pytest.fixture
def service(tmp_path: Path) -> TemperatureService:
    database_path = tmp_path / "temperature.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute(SCHEMA)
        connection.executemany(
            """
            INSERT INTO temperature_minutes (
                minute_utc, samples, ambient_min, ambient_max, ambient_avg,
                object_min, object_max, object_avg, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("2026-10-07 06:00", 2, 19.0, 21.0, 20.0, 24.0, 26.0, 25.0, "2026-10-07T06:01:00+00:00"),
                ("2026-10-07 06:01", 3, 29.0, 31.0, 30.0, 34.0, 36.0, 35.0, "2026-10-07T06:02:00+00:00"),
                ("2026-10-08 05:00", 4, 22.0, 24.0, 23.0, 27.0, 29.0, 28.0, "2026-10-08T05:01:00+00:00"),
            ],
        )
    return TemperatureService(str(database_path), "America/Lima")


def test_stats_uses_weighted_average_and_local_time(service: TemperatureService) -> None:
    result = service.get_stats("2026-10-07T01:00:00", "2026-10-07T01:02:00")

    assert result is not None
    assert result["samples"] == 5
    assert result["ambient"] == {"min": 19.0, "max": 31.0, "avg": 26.0}
    assert result["object"] == {"min": 24.0, "max": 36.0, "avg": 31.0}
    assert result["classification"] == "calido"
    assert result["period"]["start_utc"] == "2026-10-07T06:00:00+00:00"


def test_history_uses_an_exclusive_end_and_limit(service: TemperatureService) -> None:
    result = service.get_history("2026-10-07T01:00:00", "2026-10-07T01:02:00", limit=1)

    assert len(result) == 1
    assert result[0]["minute_utc"] == "2026-10-07 06:01"


def test_daily_summary_uses_local_day_boundaries(service: TemperatureService) -> None:
    result = service.get_daily_summary("2026-10-07")

    assert result is not None
    assert result["date_local"] == "2026-10-07"
    assert result["samples"] == 5


def test_no_data_and_invalid_range(service: TemperatureService) -> None:
    assert service.get_stats("2026-10-09T01:00:00", "2026-10-09T01:10:00") is None
    with pytest.raises(InvalidTimeRangeError):
        service.get_stats("2026-10-07T01:10:00", "2026-10-07T01:00:00")


@pytest.mark.parametrize(
    ("temperature", "expected"),
    [(17.9, "frio"), (18.0, "templado"), (24.0, "calido"), (28.0, "caluroso")],
)
def test_temperature_classification(temperature: float, expected: str) -> None:
    assert classify_temperature(temperature) == expected
