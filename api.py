"""API FastAPI de consulta segura para los resúmenes MLX90614."""

import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from mobile_ingestion import (
    MobileIngestionConfigurationError,
    MobileIngestionService,
    MobileIngestionUnavailableError,
    MobileReading,
    load_mobile_sync_token,
)

from temperature_service import (
    ConfigurationError,
    DatabaseTemporarilyUnavailableError,
    InvalidTimeRangeError,
    TemperatureService,
)


app = FastAPI(
    title="MLX90614 Temperature API",
    version="1.0.0",
    description="Consultas históricas de solo lectura y una subida móvil autenticada por lotes.",
    openapi_tags=[
        {"name": "system", "description": "Estado del servicio."},
        {"name": "temperature", "description": "Consultas históricas y agregadas de temperatura."},
        {"name": "mobile", "description": "Subida manual autenticada desde la aplicación móvil."},
    ],
)


class MobileReadingPayload(BaseModel):
    source_id: str = Field(min_length=8, max_length=128)
    captured_at_utc: datetime
    ambient: float
    object: float
    sequence: int | None = None

    @field_validator("captured_at_utc")
    @classmethod
    def timestamp_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("captured_at_utc debe incluir zona horaria")
        return value.astimezone(timezone.utc)

    @field_validator("ambient", "object")
    @classmethod
    def temperature_must_be_finite(cls, value: float) -> float:
        if not -100.0 <= value <= 1000.0:
            raise ValueError("Temperatura fuera de rango")
        return value


class MobileBatchPayload(BaseModel):
    device_id: str = Field(min_length=8, max_length=128)
    readings: list[MobileReadingPayload] = Field(min_length=1, max_length=500)


def get_service() -> TemperatureService:
    try:
        return TemperatureService.from_environment()
    except ConfigurationError as error:
        raise HTTPException(status_code=500, detail="La configuración de la API no es válida") from error


def run_query(callback):
    try:
        return callback()
    except InvalidTimeRangeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except DatabaseTemporarilyUnavailableError as error:
        raise HTTPException(status_code=503, detail="La base de datos está temporalmente ocupada") from error


def verify_mobile_sync_token(token: str | None) -> None:
    try:
        expected = load_mobile_sync_token()
    except MobileIngestionConfigurationError as error:
        raise HTTPException(status_code=503, detail="La subida móvil no está configurada") from error
    if token is None or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Token de sincronización inválido")


@app.get("/health", tags=["system"], summary="Comprobar el estado de la API")
def health() -> dict[str, str]:
    try:
        service = get_service()
    except HTTPException:
        return {"status": "ok", "database": "unavailable"}
    return {"status": "ok", "database": "available" if service.database_available() else "unavailable"}


@app.get("/temperature/latest", tags=["temperature"], summary="Obtener el último minuto disponible")
def latest_temperature() -> dict:
    service = get_service()
    result = run_query(service.get_latest)
    if result is None:
        return {"found": False, "message": "No hay datos disponibles"}
    return {"found": True, **result}


@app.get("/temperature/stats", tags=["temperature"], summary="Calcular estadísticas ponderadas por muestras")
def temperature_stats(
    start: Annotated[str, Query(description="Inicio ISO 8601; sin zona horaria se interpreta en LOCAL_TIMEZONE")],
    end: Annotated[str, Query(description="Fin ISO 8601 exclusivo; sin zona horaria se interpreta en LOCAL_TIMEZONE")],
) -> dict:
    service = get_service()
    result = run_query(lambda: service.get_stats(start, end))
    if result is None:
        return {"found": False, "message": "No hay datos para ese periodo"}
    return {"found": True, **result}


@app.get("/temperature/history", tags=["temperature"], summary="Obtener resúmenes por minuto")
def temperature_history(
    start: Annotated[str, Query(description="Inicio ISO 8601")],
    end: Annotated[str, Query(description="Fin ISO 8601 exclusivo")],
    limit: Annotated[int, Query(ge=1, le=5000, description="Máximo de filas a devolver")] = 500,
) -> dict:
    service = get_service()
    result = run_query(lambda: service.get_history(start, end, limit))
    if not result:
        return {"found": False, "count": 0, "data": []}
    return {"found": True, "count": len(result), "data": result}


@app.get("/temperature/daily-summary", tags=["temperature"], summary="Calcular el resumen de un día local")
def daily_summary(
    date: Annotated[str, Query(description="Fecha local en formato YYYY-MM-DD")],
) -> dict:
    service = get_service()
    result = run_query(lambda: service.get_daily_summary(date))
    if result is None:
        return {"found": False, "message": "No hay datos para ese día"}
    return {"found": True, **result}


@app.post(
    "/mobile/v1/readings/batch",
    tags=["mobile"],
    summary="Subir manualmente un lote de lecturas locales",
    status_code=status.HTTP_200_OK,
)
def upload_mobile_readings(
    payload: MobileBatchPayload,
    x_mlx_sync_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Endpoint de escritura limitado: no acepta SQL ni modifica temperature_minutes."""
    verify_mobile_sync_token(x_mlx_sync_token)
    readings = [
        MobileReading(
            source_id=reading.source_id,
            captured_at_utc=reading.captured_at_utc.isoformat(),
            ambient=reading.ambient,
            object=reading.object,
            sequence=reading.sequence,
        )
        for reading in payload.readings
    ]
    try:
        accepted = MobileIngestionService.from_environment().store_batch(payload.device_id, readings)
    except MobileIngestionUnavailableError as error:
        raise HTTPException(status_code=503, detail="La base está ocupada; reintenta la subida") from error
    return {"accepted_source_ids": accepted, "count": len(accepted)}

