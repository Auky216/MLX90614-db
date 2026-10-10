import type { MinuteSummary, TemperatureReading } from "@/types";

export const formatTemperature = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} °C` : "—";

export const formatReadingTime = (reading: TemperatureReading | null) => {
  if (!reading) return "Sin lecturas";
  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(reading.capturedAtUtc));
};

export const formatMinute = (summary: MinuteSummary | null) => {
  if (!summary) return "Sin minuto completado";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(`${summary.minuteUtc}:00.000Z`));
};
