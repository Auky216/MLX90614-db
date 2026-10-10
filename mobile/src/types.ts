export type ConnectionStatus = "disconnected" | "scanning" | "connecting" | "connected";

export type TemperatureReading = {
  sourceId: string;
  capturedAtUtc: string;
  ambient: number;
  object: number;
  sequence?: number;
  syncedAtUtc: string | null;
};

export type MinuteSummary = {
  minuteUtc: string;
  samples: number;
  ambientMin: number;
  ambientMax: number;
  ambientAvg: number;
  objectMin: number;
  objectMax: number;
  objectAvg: number;
};

export type LocalStats = {
  pending: number;
  total: number;
  latest: TemperatureReading | null;
  latestMinute: MinuteSummary | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAtUtc: string;
};

export type BlePayload = {
  ambient: number;
  object: number;
  sequence?: number;
};
