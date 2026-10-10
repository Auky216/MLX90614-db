from fastapi.testclient import TestClient

from api import app


def test_mobile_sync_requires_token_and_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "mobile.db"))
    monkeypatch.setenv("MOBILE_SYNC_TOKEN", "test-token")
    client = TestClient(app)
    payload = {
        "device_id": "iphone-device-0001",
        "readings": [
            {
                "source_id": "phone-reading-0001",
                "captured_at_utc": "2026-10-10T12:00:00Z",
                "ambient": 28.31,
                "object": 27.85,
                "sequence": 1,
            }
        ],
    }

    assert client.post("/mobile/v1/readings/batch", json=payload).status_code == 401
    first = client.post("/mobile/v1/readings/batch", json=payload, headers={"X-MLX-Sync-Token": "test-token"})
    second = client.post("/mobile/v1/readings/batch", json=payload, headers={"X-MLX-Sync-Token": "test-token"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["accepted_source_ids"] == ["phone-reading-0001"]


def test_mobile_minute_sync_requires_token_and_stores_one_minute(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "mobile.db"))
    monkeypatch.setenv("MOBILE_SYNC_TOKEN", "test-token")
    client = TestClient(app)
    payload = {
        "device_id": "iphone-device-0001",
        "minutes": [{
            "minute_utc": "2026-10-10T12:00:00Z",
            "samples": 60,
            "ambient_min": 28.0,
            "ambient_max": 28.5,
            "ambient_avg": 28.25,
            "object_min": 27.0,
            "object_max": 27.5,
            "object_avg": 27.25,
        }],
    }

    assert client.post("/mobile/v1/minutes/batch", json=payload).status_code == 401
    first = client.post("/mobile/v1/minutes/batch", json=payload, headers={"X-MLX-Sync-Token": "test-token"})
    second = client.post("/mobile/v1/minutes/batch", json=payload, headers={"X-MLX-Sync-Token": "test-token"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["accepted_minute_utc"] == ["2026-10-10 12:00"]
