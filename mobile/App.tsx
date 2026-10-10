import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./global.css";
import { Alert, FlatList, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";

import { ArchiveIllustration, ChatIllustration } from "@/components/illustrations";
import { AppIcon, BottomNavigation, type NavigationTab } from "@/components/navigation";
import { TemperatureChart } from "@/components/temperature-chart";
import { Button, Card, Metric, OutlineButton } from "@/components/ui";
import { formatMinute, formatReadingTime, formatTemperature } from "@/lib/format";
import { MlxBleClient } from "@/services/ble";
import { askLocalTemperatureAssistant, getLocalAIStatus } from "@/services/local-ai";
import { getLocalStats, getRecentSummaries, initializeDatabase, listChatMessages, saveChatMessage, saveReading } from "@/services/database";
import { getSyncToken, setSyncToken } from "@/services/settings";
import { syncCompletedMinutes } from "@/services/sync";
import type { ChatMessage, ConnectionStatus, LocalStats, MinuteSummary } from "@/types";

type Tab = NavigationTab;
type HistoryRange = "1h" | "6h" | "24h" | "7d" | "all";

const EMPTY_STATS: LocalStats = { pendingMinutes: 0, total: 0, latest: null, latestMinute: null, lastSyncedAtUtc: null };
const RANGES: { key: HistoryRange; label: string; hours?: number }[] = [
  { key: "1h", label: "1 h", hours: 1 }, { key: "6h", label: "6 h", hours: 6 },
  { key: "24h", label: "24 h", hours: 24 }, { key: "7d", label: "7 días", hours: 168 }, { key: "all", label: "Todo" },
];

function statusLabel(status: ConnectionStatus) { return { disconnected: "Desconectado", scanning: "Buscando sensor", connecting: "Conectando", connected: "Conectado" }[status]; }
function summaryDate(summary: MinuteSummary) { return new Date(`${summary.minuteUtc}:00.000Z`).getTime(); }
function summariesForRange(summaries: MinuteSummary[], range: HistoryRange) {
  const hours = RANGES.find((item) => item.key === range)?.hours;
  return hours ? summaries.filter((summary) => summaryDate(summary) >= Date.now() - hours * 3_600_000) : summaries;
}
function calculatePeriod(summaries: MinuteSummary[]) {
  if (!summaries.length) return null;
  const samples = summaries.reduce((total, summary) => total + summary.samples, 0);
  return {
    samples,
    ambientMin: Math.min(...summaries.map((item) => item.ambientMin)), ambientMax: Math.max(...summaries.map((item) => item.ambientMax)),
    objectMin: Math.min(...summaries.map((item) => item.objectMin)), objectMax: Math.max(...summaries.map((item) => item.objectMax)),
    ambientAvg: summaries.reduce((total, item) => total + item.ambientAvg * item.samples, 0) / samples,
    objectAvg: summaries.reduce((total, item) => total + item.objectAvg * item.samples, 0) / samples,
  };
}
function readableSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  const normalized = message.toLowerCase();
  if (normalized.includes("app transport security") || normalized.includes("secure connection")) return "iOS bloqueó la conexión HTTP. Instala nuevamente la app después de compilar esta versión.";
  if (normalized.includes("hostname") || normalized.includes("could not be found")) return "No se encontró el servidor. Revisa EXPO_PUBLIC_SYNC_BASE_URL y vuelve a instalar la app.";
  return message;
}
function formatSyncTime(value: string | null) {
  if (!value) return "Aún no se enviaron minutos";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
function SectionTitle({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return <View className="mb-1">{eyebrow ? <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-graphite">{eyebrow}</Text> : null}<Text className="mt-1 text-2xl font-bold tracking-tight text-ink">{title}</Text>{detail ? <Text className="mt-1 text-sm leading-5 text-graphite">{detail}</Text> : null}</View>;
}
function RangePicker({ value, onChange }: { value: HistoryRange; onChange: (next: HistoryRange) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{RANGES.map((item) => { const active = value === item.key; return <Pressable key={item.key} onPress={() => onChange(item.key)} className={active ? "rounded-full bg-ink px-4 py-2.5" : "rounded-full border border-line bg-paper px-4 py-2.5"}><Text className={active ? "text-xs font-semibold text-paper" : "text-xs font-semibold text-ink"}>{item.label}</Text></Pressable>; })}</ScrollView>;
}

export default function App() {
  const ble = useRef(new MlxBleClient());
  const [tab, setTab] = useState<Tab>("inicio");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [connectionMessage, setConnectionMessage] = useState("Sin conexión BLE");
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [summaries, setSummaries] = useState<MinuteSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("24h");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncToken, setSyncTokenValue] = useState("");
  const [localAIAvailable, setLocalAIAvailable] = useState(false);
  const [localAIStatus, setLocalAIStatus] = useState("Verificando modelo local…");
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState(false);
  const automaticSyncInProgress = useRef(false);

  const refresh = useCallback(async () => {
    const [nextStats, nextSummaries] = await Promise.all([getLocalStats(), getRecentSummaries(5000)]);
    setStats(nextStats); setSummaries(nextSummaries);
  }, []);

  const synchronizeAutomatically = useCallback(async () => {
    if (automaticSyncInProgress.current) return;
    automaticSyncInProgress.current = true;
    setSyncing(true);
    try {
      await syncCompletedMinutes();
      setSyncError(null);
      await refresh();
    } catch (error) {
      setSyncError(readableSyncError(error));
    } finally {
      automaticSyncInProgress.current = false;
      setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        await initializeDatabase(); await refresh(); setMessages(await listChatMessages()); setSyncTokenValue((await getSyncToken()) ?? "");
        const localAI = await getLocalAIStatus(); setLocalAIAvailable(localAI.available); setLocalAIStatus(localAI.available ? "Apple Intelligence local está listo." : localAI.reason);
        void synchronizeAutomatically();
      } catch { Alert.alert("Base local", "No se pudo preparar la base SQLite local."); } finally { setLoading(false); }
    })();
    const syncTimer = setInterval(() => { void synchronizeAutomatically(); }, 30_000);
    return () => { clearInterval(syncTimer); void ble.current.destroy(); };
  }, [refresh, synchronizeAutomatically]);

  const selectedSummaries = useMemo(() => summariesForRange(summaries, historyRange), [summaries, historyRange]);
  const period = useMemo(() => calculatePeriod(selectedSummaries), [selectedSummaries]);
  const subtitle = loading ? "Preparando datos locales…" : connectionMessage;
  const connect = async () => {
    try { await ble.current.connect((status, message) => { setConnectionStatus(status); setConnectionMessage(message ?? statusLabel(status)); }, async (payload) => { await saveReading({ capturedAtUtc: new Date().toISOString(), ambient: payload.ambient, object: payload.object, sequence: payload.sequence }); await refresh(); void synchronizeAutomatically(); }); }
    catch (error) { setConnectionStatus("disconnected"); setConnectionMessage(error instanceof Error ? error.message : "No se pudo conectar"); }
  };
  const disconnect = async () => { await ble.current.disconnect((status, message) => { setConnectionStatus(status); setConnectionMessage(message ?? statusLabel(status)); }); };
  const saveSettings = async () => { await setSyncToken(syncToken); Alert.alert("Ajustes guardados", "El token quedó en el llavero seguro del iPhone."); };
  const sendQuestion = async (requestedQuestion = question) => {
    const content = requestedQuestion.trim(); if (!content || answering) return;
    setQuestion(""); setAnswering(true); const userMessage = await saveChatMessage("user", content); setMessages((current) => [...current, userMessage]);
    try { const answer = await askLocalTemperatureAssistant(content, stats, summaries, messages); const assistantMessage = await saveChatMessage("assistant", answer); setMessages((current) => [...current, assistantMessage]); }
    catch (error) { const assistantMessage = await saveChatMessage("assistant", error instanceof Error ? error.message : "No se pudo responder"); setMessages((current) => [...current, assistantMessage]); }
    finally { setAnswering(false); }
  };

  return <SafeAreaView style={{ flex: 1 }} className="bg-canvas">
    <View className="border-b border-line bg-canvas px-5 pb-4 pt-3"><View className="flex-row items-center justify-between"><View><Text className="text-[11px] font-semibold uppercase tracking-[2.5px] text-graphite">Monitor local</Text><Text className="mt-1 text-[27px] font-bold tracking-tight text-ink">MLX90614</Text></View><Pressable accessibilityLabel="Abrir ajustes" onPress={() => setTab("ajustes")} className="h-11 w-11 items-center justify-center rounded-full border border-line bg-paper"><AppIcon name="settings" size={20} /></Pressable></View><View className="mt-3 flex-row items-center"><View className={connectionStatus === "connected" ? "mr-2 h-2 w-2 rounded-full bg-ink" : "mr-2 h-2 w-2 rounded-full bg-line"} /><Text className="text-sm text-graphite">{subtitle}</Text></View></View>
    <View style={{ flex: 1, paddingBottom: 88 }}>
      {tab === "inicio" ? <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerClassName="gap-4 px-5 pb-7 pt-5">
        <Card className="overflow-hidden bg-ink p-0"><View className="p-5"><View className="flex-row items-start justify-between"><View><Text className="text-xs font-semibold uppercase tracking-[2px] text-[#C8C8C2]">Lectura actual</Text><Text className="mt-2 text-4xl font-bold tracking-tight text-paper">{formatTemperature(stats.latest?.ambient)}</Text><Text className="mt-1 text-sm text-[#D8D8D3]">Ambiente · {formatReadingTime(stats.latest)}</Text></View><View className="rounded-2xl bg-paper/15 p-3"><AppIcon name="thermometer" active size={26} /></View></View><View className="mt-5 border-t border-white/20 pt-4"><Text className="text-base font-semibold text-paper">Objeto {formatTemperature(stats.latest?.object)}</Text></View></View></Card>
        <Card><View className="flex-row items-center justify-between"><View className="flex-row items-center"><View className="mr-3 rounded-2xl bg-mist p-2.5"><AppIcon name="bluetooth" size={22} /></View><View><Text className="text-xs font-semibold uppercase tracking-[1.5px] text-graphite">ESP32 · BLE</Text><Text className="mt-1 text-lg font-bold text-ink">{statusLabel(connectionStatus)}</Text></View></View><View className={connectionStatus === "connected" ? "h-2.5 w-2.5 rounded-full bg-ink" : "h-2.5 w-2.5 rounded-full bg-line"} /></View>{connectionStatus === "connected" ? <OutlineButton className="mt-5" onPress={() => void disconnect()}>Desconectar sensor</OutlineButton> : <Button className="mt-5" onPress={() => void connect()}>Conectar al ESP32</Button>}</Card>
        <View className="flex-row gap-3"><Metric label="Promedio ambiente" value={formatTemperature(stats.latestMinute?.ambientAvg)} detail={formatMinute(stats.latestMinute)} /><Metric label="Promedio objeto" value={formatTemperature(stats.latestMinute?.objectAvg)} detail={`${stats.latestMinute?.samples ?? 0} muestras del minuto`} /></View>
        <Card><View className="flex-row items-center justify-between"><View><Text className="text-xs font-semibold uppercase tracking-[1.5px] text-graphite">Sincronización automática</Text><Text className="mt-2 text-lg font-bold text-ink">{syncing ? "Enviando minutos…" : "Activa"}</Text><Text className="mt-1 text-sm text-graphite">Último envío: {formatSyncTime(stats.lastSyncedAtUtc)}</Text></View><View className="rounded-2xl bg-mist p-3"><AppIcon name="upload" size={22} /></View></View><View className="mt-4 rounded-2xl bg-mist p-3"><Text className="text-sm font-semibold text-ink">{stats.pendingMinutes} minuto(s) pendiente(s)</Text><Text className="mt-1 text-xs leading-4 text-graphite">Solo se envían minutos cerrados. El minuto actual sigue acumulando muestras.</Text></View>{syncError ? <Text className="mt-3 text-xs leading-4 text-graphite">Último intento: {syncError}</Text> : null}</Card>
      </ScrollView> : null}
      {tab === "historial" ? <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerClassName="gap-5 px-5 pb-7 pt-5"><SectionTitle eyebrow="Datos locales" title="Historial" detail="Resumen por minuto calculado dentro de tu iPhone." /><RangePicker value={historyRange} onChange={setHistoryRange} /><Card><Text className="text-base font-bold text-ink">Temperaturas promedio</Text><Text className="mt-1 text-sm text-graphite">Ambiente y objeto por minuto</Text><View className="mt-5"><TemperatureChart summaries={selectedSummaries} /></View></Card><View className="flex-row gap-3"><Metric label="Promedio ambiente" value={formatTemperature(period?.ambientAvg)} detail={period ? `min ${period.ambientMin.toFixed(1)} · max ${period.ambientMax.toFixed(1)}` : "Sin datos"} /><Metric label="Promedio objeto" value={formatTemperature(period?.objectAvg)} detail={period ? `min ${period.objectMin.toFixed(1)} · max ${period.objectMax.toFixed(1)}` : "Sin datos"} /></View><Card><Text className="text-base font-bold text-ink">Rango de temperatura</Text><Text className="mt-1 text-sm text-graphite">Mínimos y máximos del periodo</Text><View className="mt-5"><TemperatureChart summaries={selectedSummaries} mode="range" /></View><View className="mt-3 rounded-2xl bg-mist p-3"><Text className="text-sm font-semibold text-ink">{period?.samples ?? 0} muestras en el periodo seleccionado</Text></View></Card><View className="mt-1 flex-row items-center justify-between"><Text className="text-lg font-bold text-ink">Minutos recientes</Text><Text className="text-sm text-graphite">{selectedSummaries.length}</Text></View>{selectedSummaries.slice(0, 40).map((summary) => <Card key={summary.minuteUtc} className="p-4"><View className="flex-row items-center justify-between"><Text className="font-semibold text-ink">{formatMinute(summary)}</Text><Text className="text-xs text-graphite">{summary.samples} muestras</Text></View><View className="mt-3 flex-row"><Text className="flex-1 text-sm text-graphite">Ambiente <Text className="font-semibold text-ink">{formatTemperature(summary.ambientAvg)}</Text></Text><Text className="flex-1 text-right text-sm text-graphite">Objeto <Text className="font-semibold text-ink">{formatTemperature(summary.objectAvg)}</Text></Text></View></Card>)}{!selectedSummaries.length ? <Card className="items-center bg-mist"><ArchiveIllustration size={70} /><Text className="mt-3 text-center text-sm text-graphite">Conecta el ESP32 para crear tu primer resumen por minuto.</Text></Card> : null}</ScrollView> : null}
      {tab === "chat" ? <View style={{ flex: 1 }} className="px-5 pt-5"><View className="flex-row items-center rounded-[24px] border border-line bg-paper p-4"><View className="rounded-2xl bg-mist p-2"><ChatIllustration size={38} /></View><View className="ml-3 flex-1"><Text className="text-lg font-bold text-ink">Asistente local</Text><Text className="mt-0.5 text-sm text-graphite">{localAIAvailable ? "Apple Intelligence en este iPhone" : "Resumen local de tus datos"}</Text></View></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-4">{["¿Cuál es la última temperatura?", "Resume el último minuto", "¿Cuántas lecturas hay pendientes?"].map((prompt) => <Pressable key={prompt} disabled={answering} onPress={() => void sendQuestion(prompt)} className="rounded-full border border-line bg-paper px-4 py-2.5"><Text className="text-xs font-semibold text-ink">{prompt}</Text></Pressable>)}</ScrollView><FlatList style={{ flex: 1 }} data={messages} keyExtractor={(message) => message.id} contentContainerClassName="gap-3 pb-4" renderItem={({ item }) => <View className={item.role === "user" ? "max-w-[85%] self-end rounded-[20px] rounded-br-md bg-ink px-4 py-3" : "max-w-[85%] self-start rounded-[20px] rounded-bl-md border border-line bg-paper px-4 py-3"}><Text className={item.role === "user" ? "leading-5 text-paper" : "leading-5 text-ink"}>{item.content}</Text></View>} ListEmptyComponent={<Card className="mt-4 items-center bg-mist"><ChatIllustration size={68} /><Text className="mt-3 text-base font-bold text-ink">Pregunta por tus lecturas</Text><Text className="mt-1 text-center text-sm leading-5 text-graphite">El asistente consulta los datos guardados en SQLite dentro de este iPhone.</Text></Card>} /><View className="flex-row items-center gap-2 border-t border-line bg-canvas pb-3 pt-3"><TextInput value={question} onChangeText={setQuestion} onSubmitEditing={() => void sendQuestion()} placeholder="Escribe una pregunta" placeholderTextColor="#777771" className="min-h-12 flex-1 rounded-full border border-line bg-paper px-4 py-3 text-ink" /><Pressable disabled={answering} onPress={() => void sendQuestion()} className="h-12 w-12 items-center justify-center rounded-full bg-ink"><AppIcon name="upload" active size={19} /></Pressable></View></View> : null}
      {tab === "ajustes" ? <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerClassName="gap-5 px-5 pb-7 pt-5"><SectionTitle eyebrow="Configuración" title="Ajustes" detail="Tus lecturas siguen en el iPhone hasta que decidas sincronizarlas." /><Card><Text className="text-lg font-bold text-ink">Token de sincronización</Text><Text className="mt-2 text-sm leading-5 text-graphite">Autoriza la subida manual hacia tu API. Se guarda en el llavero seguro del iPhone.</Text><TextInput value={syncToken} onChangeText={setSyncTokenValue} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Pega el token del servidor" placeholderTextColor="#777771" className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-3 text-ink" /></Card><Card className="bg-mist"><Text className="text-lg font-bold text-ink">Asistente IA</Text><Text className="mt-2 text-sm leading-5 text-graphite">{localAIStatus}</Text><Text className="mt-3 text-sm leading-5 text-graphite">El asistente analiza SQLite local. No usa tu Mac, una API key ni un servicio externo.</Text></Card><Button onPress={() => void saveSettings()}>Guardar ajustes</Button></ScrollView> : null}
    </View>
    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><BottomNavigation value={tab} onChange={setTab} /></View>
  </SafeAreaView>;
}
