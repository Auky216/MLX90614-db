import sqlite3

from mobile_ingestion import MobileIngestionService, MobileReading


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
