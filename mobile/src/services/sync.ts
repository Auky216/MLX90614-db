import { getPendingMinuteSummaries, markMinuteSummariesSynced } from "@/services/database";
import { getOrCreateDeviceId, getSyncToken } from "@/services/settings";

const BATCH_SIZE = 500;

export type SyncResult = { uploadedMinutes: number; pendingMinutes: number };

export async function syncCompletedMinutes(): Promise<SyncResult> {
  const baseUrl = process.env.EXPO_PUBLIC_SYNC_BASE_URL?.replace(/\/$/, "");
  const token = await getSyncToken();
  if (!baseUrl) throw new Error("Configura EXPO_PUBLIC_SYNC_BASE_URL en mobile/.env");
  if (!token) throw new Error("Configura el token de sincronización en Ajustes");

  const deviceId = await getOrCreateDeviceId();
  let uploadedMinutes = 0;
  while (true) {
    const batch = await getPendingMinuteSummaries(BATCH_SIZE);
    if (!batch.length) return { uploadedMinutes, pendingMinutes: 0 };
    const response = await fetch(`${baseUrl}/mobile/v1/minutes/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MLX-Sync-Token": token,
      },
      body: JSON.stringify({
        device_id: deviceId,
        minutes: batch.map((minute) => ({
          minute_utc: `${minute.minuteUtc.replace(" ", "T")}:00Z`,
          samples: minute.samples,
          ambient_min: minute.ambientMin,
          ambient_max: minute.ambientMax,
          ambient_avg: minute.ambientAvg,
          object_min: minute.objectMin,
          object_max: minute.objectMax,
          object_avg: minute.objectAvg,
        })),
      }),
    });
    if (!response.ok) throw new Error(`El servidor rechazó la subida (${response.status})`);
    const payload = (await response.json()) as { accepted_minute_utc?: string[] };
    const accepted = payload.accepted_minute_utc;
    if (!accepted || accepted.length !== batch.length) {
      throw new Error("El servidor no confirmó todos los minutos del lote");
    }
    await markMinuteSummariesSynced(accepted);
    uploadedMinutes += accepted.length;
  }
}
