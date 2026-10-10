import { requireOptionalNativeModule } from "expo-modules-core";

import type { ChatMessage, LocalStats, MinuteSummary } from "@/types";

type NativeLocalAI = {
  availability(): Promise<{ status: "available" | "unavailable"; reason: string }>;
  answer(question: string, context: string): Promise<string>;
};

const nativeLocalAI = requireOptionalNativeModule<NativeLocalAI>("MLXLocalAI");

function temperature(value: number | undefined): string {
  return value === undefined ? "sin lectura" : `${value.toFixed(2)} °C`;
}

function localFallback(question: string, stats: LocalStats): string {
  if (!stats.latest) return "Aún no hay lecturas locales. Conecta el ESP32 para comenzar a medir.";
  const latestMinute = stats.latestMinute;
  const values = [
    `La última lectura fue ambiente ${temperature(stats.latest.ambient)} y objeto ${temperature(stats.latest.object)}.`,
    latestMinute
      ? `El último minuto tuvo ${latestMinute.samples} muestras: ambiente promedio ${temperature(latestMinute.ambientAvg)} y objeto promedio ${temperature(latestMinute.objectAvg)}.`
      : "Todavía no hay un minuto completo agregado.",
    `Hay ${stats.pending} lecturas pendientes de subida; los datos permanecen en este iPhone.`,
  ];
  if (/pendiente|subir|sincron/i.test(question)) return values[2];
  if (/promedio|minuto/i.test(question)) return values[1];
  return `${values[0]} ${values[1]}`;
}

function contextForAI(stats: LocalStats, summaries: MinuteSummary[], history: ChatMessage[]): string {
  return JSON.stringify({
    latest_reading: stats.latest,
    latest_minute: stats.latestMinute,
    pending_readings: stats.pending,
    recent_minute_summaries: summaries.slice(0, 60),
    conversation: history.slice(-10).map(({ role, content }) => ({ role, content })),
  });
}

export async function getLocalAIStatus(): Promise<{ available: boolean; reason: string }> {
  if (!nativeLocalAI) return { available: false, reason: "Reinstala la app para incluir el asistente local." };
  const result = await nativeLocalAI.availability();
  return { available: result.status === "available", reason: result.reason };
}

export async function askLocalTemperatureAssistant(
  question: string,
  stats: LocalStats,
  summaries: MinuteSummary[],
  history: ChatMessage[],
): Promise<string> {
  if (!nativeLocalAI) return localFallback(question, stats);
  const status = await getLocalAIStatus();
  if (!status.available) return localFallback(question, stats);
  return nativeLocalAI.answer(question, contextForAI(stats, summaries, history));
}
