"""API FastAPI de consulta segura para los resúmenes MLX90614."""

from typing import Annotated

from fastapi import FastAPI, HTTPException, Query

from temperature_service import (
    ConfigurationError,
    DatabaseTemporarilyUnavailableError,
    InvalidTimeRangeError,
    TemperatureService,
)


app = FastAPI(
    title="MLX90614 Temperature API",
    version="1.0.0",
    description="Consultas de solo lectura para datos de temperatura agregados por minuto.",
    openapi_tags=[
        {"name": "system", "description": "Estado del servicio."},
        {"name": "temperature", "description": "Consultas históricas y agregadas de temperatura."},
    ],
)


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

