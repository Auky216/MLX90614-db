import { getPendingReadings, markReadingsSynced } from "@/services/database";
import { getOrCreateDeviceId, getSyncToken } from "@/services/settings";

const BATCH_SIZE = 500;

export type SyncResult = { uploaded: number; pending: number };

export async function syncPendingReadings(onProgress?: (uploaded: number) => void): Promise<SyncResult> {
  const baseUrl = process.env.EXPO_PUBLIC_SYNC_BASE_URL?.replace(/\/$/, "");
  const token = await getSyncToken();
  if (!baseUrl) throw new Error("Configura EXPO_PUBLIC_SYNC_BASE_URL en mobile/.env");
  if (!token) throw new Error("Configura el token de sincronización en Ajustes");

  const deviceId = await getOrCreateDeviceId();
  let uploaded = 0;
  while (true) {
    const batch = await getPendingReadings(BATCH_SIZE);
    if (!batch.length) return { uploaded, pending: 0 };
    const response = await fetch(`${baseUrl}/mobile/v1/readings/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MLX-Sync-Token": token,
      },
      body: JSON.stringify({
        device_id: deviceId,
        readings: batch.map((reading) => ({
          source_id: reading.sourceId,
          captured_at_utc: reading.capturedAtUtc,
          ambient: reading.ambient,
          object: reading.object,
          sequence: reading.sequence ?? null,
        })),
      }),
    });
    if (!response.ok) throw new Error(`El servidor rechazó la subida (${response.status})`);
    const payload = (await response.json()) as { accepted_source_ids?: string[] };
    const accepted = payload.accepted_source_ids;
    if (!accepted || accepted.length !== batch.length) {
      throw new Error("El servidor no confirmó todas las lecturas del lote");
    }
    await markReadingsSynced(accepted);
    uploaded += accepted.length;
    onProgress?.(uploaded);
  }
}
