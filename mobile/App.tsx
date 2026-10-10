import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./global.css";
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ArchiveIllustration, BluetoothIllustration, ChatIllustration, SensorIllustration } from "@/components/illustrations";
import { BottomNavigation, type NavigationTab } from "@/components/navigation";
import { Button, Card, Metric, OutlineButton } from "@/components/ui";
import { formatMinute, formatReadingTime, formatTemperature } from "@/lib/format";
import { MlxBleClient } from "@/services/ble";
import { askLocalTemperatureAssistant, getLocalAIStatus } from "@/services/local-ai";
import {
  getLocalStats,
  getRecentReadings,
  getRecentSummaries,
  initializeDatabase,
  listChatMessages,
  saveChatMessage,
  saveReading,
} from "@/services/database";
import { getSyncToken, setSyncToken } from "@/services/settings";
import { syncPendingReadings } from "@/services/sync";
import type { ChatMessage, ConnectionStatus, LocalStats, MinuteSummary, TemperatureReading } from "@/types";

type Tab = NavigationTab;

const EMPTY_STATS: LocalStats = { pending: 0, total: 0, latest: null, latestMinute: null };

function statusLabel(status: ConnectionStatus): string {
  return {
    disconnected: "Desconectado",
    scanning: "Buscando sensor",
    connecting: "Conectando",
    connected: "Conectado",
  }[status];
}

export default function App() {
  const ble = useRef(new MlxBleClient());
  const [tab, setTab] = useState<Tab>("inicio");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [connectionMessage, setConnectionMessage] = useState("Sin conexión BLE");
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [readings, setReadings] = useState<TemperatureReading[]>([]);
  const [summaries, setSummaries] = useState<MinuteSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncToken, setSyncTokenValue] = useState("");
  const [localAIAvailable, setLocalAIAvailable] = useState(false);
  const [localAIStatus, setLocalAIStatus] = useState("Verificando modelo local…");
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState(false);

  const refresh = useCallback(async () => {
    const [nextStats, nextReadings, nextSummaries] = await Promise.all([
      getLocalStats(),
      getRecentReadings(),
      getRecentSummaries(),
    ]);
    setStats(nextStats);
    setReadings(nextReadings);
    setSummaries(nextSummaries);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await initializeDatabase();
        await refresh();
        setMessages(await listChatMessages());
        setSyncTokenValue((await getSyncToken()) ?? "");
        const localAI = await getLocalAIStatus();
        setLocalAIAvailable(localAI.available);
        setLocalAIStatus(localAI.available ? "Apple Intelligence local está listo." : localAI.reason);
      } catch {
        Alert.alert("Base local", "No se pudo preparar la base SQLite local.");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      void ble.current.destroy();
    };
  }, [refresh]);

  const connect = async () => {
    try {
      await ble.current.connect(
        (status, message) => {
          setConnectionStatus(status);
          setConnectionMessage(message ?? statusLabel(status));
        },
        async (payload) => {
          await saveReading({
            capturedAtUtc: new Date().toISOString(),
            ambient: payload.ambient,
            object: payload.object,
            sequence: payload.sequence,
          });
          await refresh();
        },
      );
    } catch (error) {
      setConnectionStatus("disconnected");
      setConnectionMessage(error instanceof Error ? error.message : "No se pudo conectar");
    }
  };

  const disconnect = async () => {
    await ble.current.disconnect((status, message) => {
      setConnectionStatus(status);
      setConnectionMessage(message ?? statusLabel(status));
    });
  };

  const sync = async () => {
    try {
      setSyncing(true);
      const result = await syncPendingReadings();
      await refresh();
      Alert.alert("Sincronización completada", `${result.uploaded} lecturas subidas.`);
    } catch (error) {
      Alert.alert("No se subieron los datos", error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setSyncing(false);
    }
  };

  const saveSettings = async () => {
    await setSyncToken(syncToken);
    Alert.alert("Ajustes guardados", "El token quedó en el llavero seguro del iPhone.");
  };

  const sendQuestion = async (requestedQuestion = question) => {
    const content = requestedQuestion.trim();
    if (!content || answering) return;
    setQuestion("");
    setAnswering(true);
    const userMessage = await saveChatMessage("user", content);
    setMessages((current) => [...current, userMessage]);
    try {
      const answer = await askLocalTemperatureAssistant(content, stats, summaries, messages);
      const assistantMessage = await saveChatMessage("assistant", answer);
      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      const message = await saveChatMessage("assistant", error instanceof Error ? error.message : "No se pudo responder");
      setMessages((current) => [...current, message]);
    } finally {
      setAnswering(false);
    }
  };

  const currentReading = stats.latest;
  const subtitle = useMemo(() => (loading ? "Preparando datos locales…" : connectionMessage), [connectionMessage, loading]);

  return (
    <SafeAreaView className="flex-1 bg-paper">
      <View className="border-b border-ink px-6 pb-4 pt-3">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold tracking-tight text-ink">MLX90614 LOCAL</Text>
            <Text className="mt-1 text-sm text-graphite">{subtitle}</Text>
          </View>
          <Pressable accessibilityLabel="Abrir ajustes" onPress={() => setTab("ajustes")} className="h-11 w-11 items-center justify-center rounded-full border border-ink">
            <Text className="text-lg font-bold text-ink">⚙</Text>
          </Pressable>
        </View>
      </View>

      {tab === "inicio" ? (
        <ScrollView contentContainerClassName="gap-5 px-6 py-6">
          <Card className="items-center bg-mist">
            <SensorIllustration />
            <Text className="mt-3 text-xl font-bold text-ink">Sensor MLX90614</Text>
            <Text className="mt-1 text-center text-sm text-graphite">Los datos se guardan primero en tu iPhone.</Text>
          </Card>
          <Card>
            <View className="flex-row items-center gap-4">
              <BluetoothIllustration size={52} />
              <View className="flex-1">
                <Text className="text-xs font-medium uppercase tracking-wider text-graphite">Bluetooth Low Energy</Text>
                <Text className="mt-1 text-lg font-bold text-ink">{statusLabel(connectionStatus)}</Text>
              </View>
            </View>
            {connectionStatus === "connected" ? (
              <OutlineButton className="mt-5" onPress={() => void disconnect()}>Desconectar</OutlineButton>
            ) : (
              <Button className="mt-5" onPress={() => void connect()}>Conectar al ESP32</Button>
            )}
          </Card>
          <View className="flex-row gap-3">
            <Metric label="Ambiente actual" value={formatTemperature(currentReading?.ambient)} detail={`Última lectura: ${formatReadingTime(currentReading)}`} />
            <Metric label="Objeto actual" value={formatTemperature(currentReading?.object)} detail="Lectura local" />
          </View>
          <View className="flex-row gap-3">
            <Metric label="Promedio ambiente" value={formatTemperature(stats.latestMinute?.ambientAvg)} detail={formatMinute(stats.latestMinute)} />
            <Metric label="Promedio objeto" value={formatTemperature(stats.latestMinute?.objectAvg)} detail={`${stats.latestMinute?.samples ?? 0} muestras`} />
          </View>
          <Card className="bg-ink">
            <Text className="text-xs font-medium uppercase tracking-wider text-paper">Pendiente de subir</Text>
            <Text className="mt-2 text-4xl font-bold text-paper">{stats.pending}</Text>
            <Text className="mt-1 text-sm text-paper">de {stats.total} lecturas almacenadas localmente</Text>
            <Pressable disabled={syncing || stats.pending === 0} onPress={() => void sync()} className="mt-5 items-center rounded-full bg-paper px-5 py-3 disabled:opacity-40">
              <Text className="font-semibold text-ink">{syncing ? "Subiendo…" : "Subir datos"}</Text>
            </Pressable>
          </Card>
        </ScrollView>
      ) : null}

      {tab === "historial" ? (
        <ScrollView contentContainerClassName="gap-5 px-6 py-6">
          <Card className="items-center bg-mist">
            <ArchiveIllustration />
            <Text className="mt-3 text-xl font-bold text-ink">Historial local</Text>
            <Text className="mt-1 text-center text-sm text-graphite">Cada lectura permanece en SQLite dentro de este iPhone.</Text>
          </Card>
          <Text className="text-lg font-bold text-ink">Últimos minutos</Text>
          {summaries.length ? summaries.map((summary) => (
            <Card key={summary.minuteUtc} className="p-4">
              <View className="flex-row justify-between"><Text className="font-bold text-ink">{formatMinute(summary)}</Text><Text className="text-sm text-graphite">{summary.samples} muestras</Text></View>
              <Text className="mt-3 text-sm text-ink">Ambiente {formatTemperature(summary.ambientAvg)} · min {summary.ambientMin.toFixed(2)} · max {summary.ambientMax.toFixed(2)}</Text>
              <Text className="mt-1 text-sm text-ink">Objeto {formatTemperature(summary.objectAvg)} · min {summary.objectMin.toFixed(2)} · max {summary.objectMax.toFixed(2)}</Text>
            </Card>
          )) : <Text className="text-graphite">Aún no hay lecturas. Conecta el ESP32 para comenzar.</Text>}
          <Text className="mt-2 text-lg font-bold text-ink">Últimas lecturas</Text>
          {readings.map((reading) => (
            <View key={reading.sourceId} className="flex-row justify-between border-b border-mist py-3">
              <Text className="text-sm text-graphite">{formatReadingTime(reading)}</Text>
              <Text className="text-sm font-semibold text-ink">A {formatTemperature(reading.ambient)} · O {formatTemperature(reading.object)}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {tab === "chat" ? (
        <View className="flex-1 px-6 py-6">
          <View className="flex-row items-center rounded-3xl border border-ink bg-mist p-4">
            <ChatIllustration size={54} />
            <View className="ml-4 flex-1">
              <Text className="text-xl font-bold text-ink">Asistente IA</Text>
              <Text className="mt-1 text-sm text-graphite">{localAIAvailable ? "IA local activa. Sin servidores." : "Resumen local disponible."}</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-4">
            {["¿Cuál es la última temperatura?", "Resume el último minuto", "¿Cuántas lecturas tengo pendientes?"].map((prompt) => (
              <Pressable key={prompt} disabled={answering} onPress={() => void sendQuestion(prompt)} className="rounded-full border border-ink bg-paper px-4 py-2 active:bg-mist">
                <Text className="text-xs font-semibold text-ink">{prompt}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <FlatList
            data={messages}
            keyExtractor={(message) => message.id}
            contentContainerClassName="gap-3 py-5"
            renderItem={({ item }) => (
              <View className={item.role === "user" ? "self-end rounded-3xl bg-ink px-4 py-3" : "self-start rounded-3xl border border-ink bg-paper px-4 py-3"}>
                <Text className={item.role === "user" ? "text-paper" : "text-ink"}>{item.content}</Text>
              </View>
            )}
            ListEmptyComponent={<Card className="mt-5"><Text className="font-bold text-ink">Pregunta por tus datos</Text><Text className="mt-2 text-sm text-graphite">Ejemplo: ¿Cuál fue el promedio de ambiente del último minuto?</Text></Card>}
          />
          <View className="flex-row gap-2 border-t border-ink pt-4">
            <TextInput value={question} onChangeText={setQuestion} onSubmitEditing={() => void sendQuestion()} placeholder="Escribe una pregunta" placeholderTextColor="#5C5C5C" className="flex-1 rounded-full border border-ink px-4 py-3 text-ink" />
            <Button disabled={answering} onPress={() => void sendQuestion()}>{answering ? "…" : "Enviar"}</Button>
          </View>
        </View>
      ) : null}

      {tab === "ajustes" ? (
        <ScrollView contentContainerClassName="gap-5 px-6 py-6">
          <Card className="bg-mist">
            <Text className="text-2xl font-bold text-ink">Ajustes</Text>
            <Text className="mt-2 text-sm text-graphite">Los tokens se guardan solamente en el llavero seguro de este iPhone.</Text>
          </Card>
          <Card>
            <Text className="text-lg font-bold text-ink">Sincronización</Text>
            <Text className="mt-2 text-sm text-graphite">La URL se lee desde mobile/.env. Pega aquí el token del servidor.</Text>
            <TextInput value={syncToken} onChangeText={setSyncTokenValue} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Token de sincronización" placeholderTextColor="#5C5C5C" className="mt-4 rounded-full border border-ink px-4 py-3 text-ink" />
          </Card>
          <Card>
            <Text className="text-lg font-bold text-ink">Chatbot IA</Text>
            <Text className="mt-2 text-sm text-graphite">{localAIStatus}</Text>
            <Text className="mt-3 text-sm text-graphite">El asistente solo usa SQLite local. No requiere URL, token, Mac, API key ni servidor.</Text>
          </Card>
          <Button onPress={() => void saveSettings()}>Guardar ajustes</Button>
        </ScrollView>
      ) : null}

      <BottomNavigation value={tab} onChange={setTab} />
    </SafeAreaView>
  );
}
