import { ipcMain } from "electron";
import Store from "electron-store";

// Initialize electron-store with proper configuration
// Using type assertion since electron-store extends Conf which has get/set/delete methods
const store = new Store<Record<string, unknown>>({
  name: "ai-worker-store",
  defaults: {},
}) as Store<Record<string, unknown>> & {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

export function registerStoreHandlers(): void {
  ipcMain.handle("store:get", (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
    store.set(key, value);
    return true;
  });

  ipcMain.handle("store:delete", (_event, key: string) => {
    store.delete(key);
    return true;
  });
}
