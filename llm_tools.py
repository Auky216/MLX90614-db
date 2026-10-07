"""Funciones de consulta preparadas para integrarse con tool calling de un LLM."""

from typing import Any

from temperature_service import TemperatureService


def _service() -> TemperatureService:
    return TemperatureService.from_environment()


def get_temperature_stats(start: str, end: str) -> dict[str, Any] | None:
    """Devuelve estadísticas ponderadas para un periodo ISO 8601."""
    return _service().get_stats(start, end)


def get_latest_temperature() -> dict[str, Any] | None:
    """Devuelve el último resumen por minuto disponible."""
    return _service().get_latest()


def get_temperature_history(start: str, end: str, limit: int = 500) -> list[dict[str, Any]]:
    """Devuelve resúmenes por minuto, con límite validado por el servicio."""
    return _service().get_history(start, end, limit)


def get_daily_summary(date: str) -> dict[str, Any] | None:
    """Devuelve el resumen ponderado de un día en LOCAL_TIMEZONE."""
    return _service().get_daily_summary(date)
