import * as SecureStore from "expo-secure-store";

const SYNC_TOKEN_KEY = "mlx90614-sync-token";
const DEVICE_ID_KEY = "mlx90614-device-id";

export async function getSyncToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SYNC_TOKEN_KEY);
}

export async function setSyncToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SYNC_TOKEN_KEY, token.trim());
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() ?? `iphone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}
