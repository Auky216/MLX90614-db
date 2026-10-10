import * as SQLite from "expo-sqlite";

import { createId } from "@/lib/id";
import type { ChatMessage, LocalStats, MinuteSummary, TemperatureReading } from "@/types";

const DATABASE_NAME = "mlx90614-mobile.db";

type MinuteAggregate = {
  samples: number;
  ambient_min: number;
  ambient_max: number;
  ambient_avg: number;
  object_min: number;
  object_max: number;
  object_avg: number;
};
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function minuteKey(isoTime: string): string {
  const value = new Date(isoTime);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")} ${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}

function rowToReading(row: Record<string, unknown>): TemperatureReading {
  return {
    sourceId: String(row.source_id),
    capturedAtUtc: String(row.captured_at_utc),
    ambient: Number(row.ambient),
    object: Number(row.object),
    sequence: row.sequence === null || row.sequence === undefined ? undefined : Number(row.sequence),
    syncedAtUtc: row.synced_at_utc ? String(row.synced_at_utc) : null,
  };
}

function rowToSummary(row: Record<string, unknown>): MinuteSummary {
  return {
    minuteUtc: String(row.minute_utc),
    samples: Number(row.samples),
    ambientMin: Number(row.ambient_min),
    ambientMax: Number(row.ambient_max),
    ambientAvg: Number(row.ambient_avg),
    objectMin: Number(row.object_min),
    objectMax: Number(row.object_max),
    objectAvg: Number(row.object_avg),
  };
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS readings (
          source_id TEXT PRIMARY KEY NOT NULL,
          minute_utc TEXT NOT NULL,
          captured_at_utc TEXT NOT NULL,
          ambient REAL NOT NULL,
          object REAL NOT NULL,
          sequence INTEGER,
          synced_at_utc TEXT
        );
        CREATE INDEX IF NOT EXISTS readings_captured_at_idx ON readings(captured_at_utc DESC);
        CREATE INDEX IF NOT EXISTS readings_pending_idx ON readings(synced_at_utc, captured_at_utc);
        CREATE TABLE IF NOT EXISTS minute_summaries (
          minute_utc TEXT PRIMARY KEY NOT NULL,
          samples INTEGER NOT NULL,
          ambient_min REAL NOT NULL,
          ambient_max REAL NOT NULL,
          ambient_avg REAL NOT NULL,
          object_min REAL NOT NULL,
          object_max REAL NOT NULL,
          object_avg REAL NOT NULL,
          updated_at_utc TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at_utc TEXT NOT NULL
        );
      `);
      return database;
    });
  }
  return databasePromise;
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}

export async function saveReading(input: Omit<TemperatureReading, "sourceId" | "syncedAtUtc"> & { sourceId?: string }): Promise<TemperatureReading> {
  if (!Number.isFinite(input.ambient) || !Number.isFinite(input.object)) {
    throw new Error("La lectura contiene temperaturas inválidas");
  }
  const reading: TemperatureReading = {
    sourceId: input.sourceId ?? createId(),
    capturedAtUtc: input.capturedAtUtc,
    ambient: input.ambient,
    object: input.object,
    sequence: input.sequence,
    syncedAtUtc: null,
  };
  const database = await getDatabase();
  const minuteUtc = minuteKey(reading.capturedAtUtc);
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT OR IGNORE INTO readings
       (source_id, minute_utc, captured_at_utc, ambient, object, sequence, synced_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      reading.sourceId,
      minuteUtc,
      reading.capturedAtUtc,
      reading.ambient,
      reading.object,
      reading.sequence ?? null,
    );
    const aggregate = await database.getFirstAsync<MinuteAggregate>(
      `SELECT COUNT(*) AS samples,
              MIN(ambient) AS ambient_min, MAX(ambient) AS ambient_max, AVG(ambient) AS ambient_avg,
              MIN(object) AS object_min, MAX(object) AS object_max, AVG(object) AS object_avg
       FROM readings WHERE minute_utc = ?`,
      minuteUtc,
    );
    if (!aggregate || Number(aggregate.samples) === 0) return;
    await database.runAsync(
      `INSERT INTO minute_summaries
       (minute_utc, samples, ambient_min, ambient_max, ambient_avg, object_min, object_max, object_avg, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(minute_utc) DO UPDATE SET
         samples = excluded.samples, ambient_min = excluded.ambient_min, ambient_max = excluded.ambient_max,
         ambient_avg = excluded.ambient_avg, object_min = excluded.object_min, object_max = excluded.object_max,
         object_avg = excluded.object_avg, updated_at_utc = excluded.updated_at_utc`,
      minuteUtc,
      aggregate.samples,
      aggregate.ambient_min,
      aggregate.ambient_max,
      aggregate.ambient_avg,
      aggregate.object_min,
      aggregate.object_max,
      aggregate.object_avg,
      new Date().toISOString(),
    );
  });
  return reading;
}

export async function getLocalStats(): Promise<LocalStats> {
  const database = await getDatabase();
  const counts = await database.getFirstAsync<Record<string, unknown>>(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN synced_at_utc IS NULL THEN 1 ELSE 0 END) AS pending FROM readings",
  );
  const latest = await database.getFirstAsync<Record<string, unknown>>(
    "SELECT source_id, captured_at_utc, ambient, object, sequence, synced_at_utc FROM readings ORDER BY captured_at_utc DESC LIMIT 1",
  );
  const latestMinute = await database.getFirstAsync<Record<string, unknown>>(
    `SELECT minute_utc, samples, ambient_min, ambient_max, ambient_avg,
            object_min, object_max, object_avg
     FROM minute_summaries ORDER BY minute_utc DESC LIMIT 1`,
  );
  return {
    total: Number(counts?.total ?? 0),
    pending: Number(counts?.pending ?? 0),
    latest: latest ? rowToReading(latest) : null,
    latestMinute: latestMinute ? rowToSummary(latestMinute) : null,
  };
}

export async function getRecentReadings(limit = 60): Promise<TemperatureReading[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT source_id, captured_at_utc, ambient, object, sequence, synced_at_utc
     FROM readings ORDER BY captured_at_utc DESC LIMIT ?`,
    limit,
  );
  return rows.map(rowToReading);
}

export async function getRecentSummaries(limit = 120): Promise<MinuteSummary[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT minute_utc, samples, ambient_min, ambient_max, ambient_avg,
            object_min, object_max, object_avg
     FROM minute_summaries ORDER BY minute_utc DESC LIMIT ?`,
    limit,
  );
  return rows.map(rowToSummary);
}

export async function getPendingReadings(limit = 500): Promise<TemperatureReading[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT source_id, captured_at_utc, ambient, object, sequence, synced_at_utc
     FROM readings WHERE synced_at_utc IS NULL ORDER BY captured_at_utc ASC LIMIT ?`,
    limit,
  );
  return rows.map(rowToReading);
}

export async function markReadingsSynced(sourceIds: string[]): Promise<void> {
  if (!sourceIds.length) return;
  const database = await getDatabase();
  const placeholders = sourceIds.map(() => "?").join(", ");
  await database.runAsync(
    `UPDATE readings SET synced_at_utc = ? WHERE source_id IN (${placeholders})`,
    new Date().toISOString(),
    ...sourceIds,
  );
}

export async function listChatMessages(limit = 80): Promise<ChatMessage[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    "SELECT id, role, content, created_at_utc FROM chat_messages ORDER BY created_at_utc ASC LIMIT ?",
    limit,
  );
  return rows.map((row) => ({
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content),
    createdAtUtc: String(row.created_at_utc),
  }));
}

export async function saveChatMessage(role: ChatMessage["role"], content: string): Promise<ChatMessage> {
  const message: ChatMessage = { id: createId(), role, content, createdAtUtc: new Date().toISOString() };
  const database = await getDatabase();
  await database.runAsync(
    "INSERT INTO chat_messages (id, role, content, created_at_utc) VALUES (?, ?, ?, ?)",
    message.id,
    message.role,
    message.content,
    message.createdAtUtc,
  );
  return message;
}
