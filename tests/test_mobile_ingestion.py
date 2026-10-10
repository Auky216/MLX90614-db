import sqlite3

from mobile_ingestion import MobileIngestionService, MobileMinute, MobileReading


def test_mobile_batch_is_idempotent_and_uses_separate_table(tmp_path):
    database_path = tmp_path / "sensor.db"
    service = MobileIngestionService(database_path)
    reading = MobileReading(
        source_id="phone-reading-0001",
        captured_at_utc="2026-10-10T12:00:00+00:00",
        ambient=28.31,
        object=27.85,
        sequence=7,
    )

    assert service.store_batch("iphone-device-0001", [reading]) == [reading.source_id]
    assert service.store_batch("iphone-device-0001", [reading]) == [reading.source_id]

    with sqlite3.connect(database_path) as connection:
        row = connection.execute(
            "SELECT COUNT(*), device_id, ambient, object FROM mobile_temperature_readings"
        ).fetchone()
    assert row == (1, "iphone-device-0001", 28.31, 27.85)


def test_mobile_minute_batch_is_idempotent_and_separate_from_mqtt(tmp_path):
    service = MobileIngestionService(tmp_path / "sensor.db")
    minute = MobileMinute(
        minute_utc="2026-10-10 12:00",
        samples=60,
        ambient_min=27.9,
        ambient_max=28.4,
        ambient_avg=28.1,
        object_min=26.8,
        object_max=27.5,
        object_avg=27.1,
    )

    assert service.store_minute_batch("iphone-device-0001", [minute]) == ["2026-10-10 12:00"]
    assert service.store_minute_batch("iphone-device-0001", [minute]) == ["2026-10-10 12:00"]

    with sqlite3.connect(tmp_path / "sensor.db") as connection:
        row = connection.execute(
            "SELECT COUNT(*), samples, ambient_avg, object_avg FROM mobile_temperature_minutes"
        ).fetchone()
    assert row == (1, 60, 28.1, 27.1)
