import { getListRelay, markRelayFirst, relayFirstFor, type ListRelay } from "./listRelay.js";

/** How long a provider gets to start answering before the request is given up. */
export const RESPONSE_TIMEOUT_MS = 20_000;

/** One request with the wait for the response bounded; body reading is not (see `fetchResponding`). */
async function respondingWithin<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The provider did not respond. Try again in a moment.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The Worker's answer for `url`, or undefined when it is unavailable or did not get a good answer (the caller then reports the direct failure). */
async function viaRelay(relay: ListRelay, url: string, timeoutMs: number): Promise<Response | undefined> {
  try {
    const response = await respondingWithin(timeoutMs, (signal) => relay(url, signal));
    if (response === undefined) return undefined;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    return response;
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * `fetch` that gives up when the provider has not started answering within `timeoutMs`. Without it a stalled
 * provider leaves a screen on "Loading..." for good. Only the wait for the response is bounded: once it has
 * started, the body (a whole catalogue can be many megabytes on a slow Fire Stick) takes as long as it takes.
 *
 * When the request itself fails (blocked, reset, no answer) and an account is signed in, the sync Worker is asked to fetch
 * the list instead (`listRelay.ts`); the provider is then tried through it first for a while. An answer from the provider,
 * whatever its status, is never relayed: only a failure to get one is. If the relay cannot help, the direct failure is thrown.
 */
export async function fetchResponding(url: string, init: RequestInit = {}, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Response> {
  const relay = init.method === undefined || init.method.toUpperCase() === "GET" ? getListRelay() : undefined;
  const host = hostOf(url);

  if (relay !== undefined && host !== undefined && relayFirstFor(host)) {
    const response = await viaRelay(relay, url, timeoutMs);
    if (response !== undefined) return response;
  }

  try {
    return await respondingWithin(timeoutMs, (signal) => fetch(url, { ...init, signal }));
  } catch (error) {
    if (relay === undefined || host === undefined) throw error;
    const response = await viaRelay(relay, url, timeoutMs);
    if (response === undefined) throw error;
    markRelayFirst(host);
    return response;
  }
}
