import { ipcMain } from "electron";
import type StoreType from "electron-store";
import { Store } from "../lib/store-wrapper";

// Initialize electron-store with proper configuration
// Using type assertion since electron-store extends Conf which has get/set/delete methods
const store = new Store<Record<string, unknown>>({
  name: "ai-worker-store",
  defaults: {},
}) as InstanceType<typeof StoreType<Record<string, unknown>>> & {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

// Keys that MUST go through secure storage (blocked from general store)
const BLOCKED_KEYS = [
  'openai_api_key',
  'gemini_api_key', 
  'openrouter_api_key',
  // Also block user-scoped versions
] as const;

function isSensitiveKey(key: string): boolean {
  // Check if key matches any blocked pattern
  return BLOCKED_KEYS.some(blocked => 
    key === blocked || 
    key.endsWith(`_${blocked}`) ||
    key.includes('api_key') ||
    key.includes('secret') ||
    key.includes('token') ||
    key.includes('password')
  );
}

export function registerStoreHandlers(): void {
  ipcMain.handle("store:get", (_event, key: string) => {
    if (isSensitiveKey(key)) {
      console.warn(`[Store] Blocked access to sensitive key: ${key}. Use secure:get instead.`);
      return undefined;
    }
    return store.get(key);
  });

  ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
    if (isSensitiveKey(key)) {
      console.warn(`[Store] Blocked write to sensitive key: ${key}. Use secure:set instead.`);
      return false;
    }
    store.set(key, value);
    return true;
  });

  ipcMain.handle("store:delete", (_event, key: string) => {
    if (isSensitiveKey(key)) {
      console.warn(`[Store] Blocked delete of sensitive key: ${key}. Use secure:delete instead.`);
      return false;
    }
    store.delete(key);
    return true;
  });

  console.log('[Store] Registered store handlers with sensitive key protection');
}
