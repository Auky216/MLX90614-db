import type { ChatMessage } from "@/types";

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
};

const SYSTEM_PROMPT = `Eres un asistente de monitoreo para un sensor MLX90614.
Los datos históricos son resúmenes por minuto UTC. Cada fila contiene samples y las estadísticas ambient_min, ambient_max, ambient_avg, object_min, object_max y object_avg. Los promedios de periodos deben estar ponderados por samples. Las preguntas sin zona horaria se interpretan en America/Lima. Usa las herramientas antes de afirmar cifras históricas. No inventes mediciones. La clasificación frio/templado/calido/caluroso es una regla de aplicación, no una medida científica de sensación térmica. Responde de forma clara en español.`;

const TOOLS = [
  { type: "function", function: { name: "get_temperature_stats", description: "Obtiene min, max, promedio ponderado, muestras y clasificación para un periodo.", parameters: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] } } },
  { type: "function", function: { name: "get_latest_temperature", description: "Obtiene el último resumen por minuto disponible.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_temperature_history", description: "Obtiene filas históricas por minuto para un rango acotado.", parameters: { type: "object", properties: { start: { type: "string" }, end: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5000 } }, required: ["start", "end"] } } },
  { type: "function", function: { name: "get_daily_summary", description: "Obtiene el resumen ponderado de un día local.", parameters: { type: "object", properties: { date: { type: "string" } }, required: ["date"] } } },
];

const ROUTES: Record<string, string> = {
  get_temperature_stats: "/temperature/stats",
  get_latest_temperature: "/temperature/latest",
  get_temperature_history: "/temperature/history",
  get_daily_summary: "/temperature/daily-summary",
};

function settings() {
  return {
    apiKey: process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY?.trim() ?? "",
    model: process.env.EXPO_PUBLIC_DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    temperatureApiBaseUrl: process.env.EXPO_PUBLIC_TEMPERATURE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "",
  };
}

export function getDeepSeekStatus(): { configured: boolean; reason: string } {
  const config = settings();
  if (!config.apiKey) return { configured: false, reason: "DeepSeek no está configurado en mobile/.env." };
  if (!config.temperatureApiBaseUrl) return { configured: false, reason: "Falta EXPO_PUBLIC_TEMPERATURE_API_BASE_URL en mobile/.env." };
  return { configured: true, reason: "DeepSeek directo está configurado para pruebas." };
}

async function executeTemperatureTool(name: string, argumentsValue: unknown, baseUrl: string): Promise<Record<string, unknown>> {
  const route = ROUTES[name];
  if (!route) return { error: "Herramienta no permitida" };
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) return { error: "Argumentos inválidos" };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(argumentsValue)) {
    if (!["start", "end", "date", "limit"].includes(key) || !["string", "number"].includes(typeof value)) {
      return { error: "Argumentos no permitidos" };
    }
    params.set(key, String(value));
  }
  try {
    const response = await fetch(`${baseUrl}${route}?${params.toString()}`);
    if (!response.ok) return { error: `La API de temperatura respondió ${response.status}` };
    return await response.json() as Record<string, unknown>;
  } catch {
    return { error: "No se pudo consultar la API de temperatura" };
  }
}

export async function askDeepSeekTemperatureAssistant(question: string, history: ChatMessage[]): Promise<string> {
  const config = settings();
  if (!config.apiKey || !config.temperatureApiBaseUrl) throw new Error("Configura DeepSeek y la URL de la API en mobile/.env.");

  const messages: DeepSeekMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-12).map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: question },
  ];

  for (let round = 0; round < 5; round += 1) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2 }),
    });
    if (!response.ok) throw new Error(`DeepSeek rechazó la consulta (${response.status}).`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: DeepSeekToolCall[] } }> };
    const answer = payload.choices?.[0]?.message;
    if (!answer) throw new Error("DeepSeek devolvió una respuesta inválida.");
    if (!answer.tool_calls?.length) return answer.content?.trim() || "DeepSeek no generó una respuesta.";

    messages.push({ role: "assistant", content: answer.content ?? null, tool_calls: answer.tool_calls });
    for (const call of answer.tool_calls) {
      let argumentsValue: unknown;
      try { argumentsValue = JSON.parse(call.function.arguments); } catch { argumentsValue = null; }
      const result = await executeTemperatureTool(call.function.name, argumentsValue, config.temperatureApiBaseUrl);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error("DeepSeek no terminó la consulta después de varias herramientas.");
}
