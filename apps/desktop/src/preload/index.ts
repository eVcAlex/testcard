import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNEL, type TestcardApi } from "../shared/ipc.js";

/**
 * Builds a `TestcardApi`-shaped proxy where every leaf method forwards to
 * `ipcRenderer.invoke(IPC_CHANNEL, "namespace.method", ...args)`. Using a Proxy instead of
 * hand-writing every method here means this file can never drift out of sync with
 * `shared/ipc.ts` — the type is the single source of truth, this is just plumbing.
 */
function createApi(): TestcardApi {
  const namespaces = ["sources", "channels", "playback"] as const;
  const api = {} as Record<string, unknown>;

  for (const namespace of namespaces) {
    api[namespace] = new Proxy(
      {},
      {
        get: (_target, method: string) => {
          return (...args: unknown[]) => ipcRenderer.invoke(IPC_CHANNEL, `${namespace}.${method}`, ...args);
        },
      },
    );
  }

  return api as unknown as TestcardApi;
}

contextBridge.exposeInMainWorld("testcard", createApi());
