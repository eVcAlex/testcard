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

/** What the relay did: its good answer, or why it did not give one (`null`: it was not tried, e.g. signed out). */
type RelayOutcome = { readonly response: Response } | { readonly why: string | null };

/** Words for a relay failure that are safe to show: a status and the Worker's own short reason, never the address (it carries the login). */
function safeReason(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** The Worker's answer for `url`, or why it gave none (the caller reports the direct failure, with this noted). */
async function viaRelay(relay: ListRelay, url: string, timeoutMs: number): Promise<RelayOutcome> {
  try {
    const response = await respondingWithin(timeoutMs, (signal) => relay(url, signal));
    if (response === undefined) return { why: null };
    if (response.ok) return { response };
    const body = await response.text().catch(() => "");
    let reason = "";
    try {
      const parsed = JSON.parse(body.slice(0, 500)) as { error?: unknown };
      if (typeof parsed.error === "string") reason = safeReason(parsed.error);
    } catch {
      /* not JSON: the provider's own page, which says nothing safe to repeat */
    }
    return { why: `HTTP ${response.status}${reason === "" ? "" : `, ${reason}`}` };
  } catch (error) {
    return { why: safeReason(error instanceof Error ? error.message : "failed") || "failed" };
  }
}

/** The direct failure, with what the relay said appended in a form `explainFailure` reads: "... (relay: HTTP 502, could not reach the provider)". */
function withRelayNote(error: unknown, why: string | null): unknown {
  if (why === null || !(error instanceof Error)) return error;
  return new Error(`${error.message} (relay: ${why})`, { cause: error });
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
 * whatever its status, is never relayed: only a failure to get one is. If the relay cannot help, the direct failure is thrown, with what the relay said noted on it (`explainFailure` words it).
 */
export async function fetchResponding(url: string, init: RequestInit = {}, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Response> {
  const relay = init.method === undefined || init.method.toUpperCase() === "GET" ? getListRelay() : undefined;
  const host = hostOf(url);

  let relayWhy: string | null = null;
  if (relay !== undefined && host !== undefined && relayFirstFor(host)) {
    const outcome = await viaRelay(relay, url, timeoutMs);
    if ("response" in outcome) return outcome.response;
    relayWhy = outcome.why;
  }

  try {
    return await respondingWithin(timeoutMs, (signal) => fetch(url, { ...init, signal }));
  } catch (error) {
    if (relay === undefined || host === undefined) throw error;
    const outcome = await viaRelay(relay, url, timeoutMs);
    if ("response" in outcome) {
      markRelayFirst(host);
      return outcome.response;
    }
    throw withRelayNote(error, outcome.why ?? relayWhy);
  }
}
