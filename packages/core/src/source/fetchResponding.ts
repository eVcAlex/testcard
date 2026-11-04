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
type RelayOutcome = { readonly response: Response } | { readonly why: string | null; readonly status?: number };

/** A provider that answers these to a viewer is usually refusing that viewer's address, not their login: the relay may get through. */
const REFUSAL_STATUSES = new Set([403, 451]);

/** A relay refusal worth asking again for: the provider may answer another address, or be past a burst. */
const retryable = (status: number | undefined) => status === 403 || status === 429 || (status !== undefined && status >= 500);

/** Pause before asking the relay again; times the attempt number. */
export const RELAY_RETRY_MS = 300;

/** Words for a relay failure that are safe to show: a status and the Worker's own short reason, never the address (it carries the login). */
function safeReason(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** The Worker's answer for `url`, asking up to `attempts` times while it is refused in a way that may pass, or why it gave none. */
async function viaRelay(relay: ListRelay, url: string, timeoutMs: number, attempts = 1): Promise<RelayOutcome> {
  let outcome: RelayOutcome = { why: null };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    outcome = await relayOnce(relay, url, timeoutMs);
    if ("response" in outcome || !retryable(outcome.status)) return outcome;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, RELAY_RETRY_MS * attempt));
  }
  return outcome;
}

async function relayOnce(relay: ListRelay, url: string, timeoutMs: number): Promise<RelayOutcome> {
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
    return { why: `HTTP ${response.status}${reason === "" ? "" : `, ${reason}`}`, status: response.status };
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
 * When the request itself fails (blocked, reset, no answer), or the provider refuses it with a 403 or 451 (a refused address
 * or network), and an account is signed in, the sync Worker is asked to fetch the list instead (`listRelay.ts`); the provider
 * is then tried through it first for a while. Any other answer (a 401 for a wrong login, a 404, a 500) is the provider's and is
 * never relayed. If the relay cannot help, the direct failure (or the provider's refusal) is what is reported, with what the relay said noted on it (`explainFailure` words it).
 */
export async function fetchResponding(url: string, init: RequestInit = {}, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Response> {
  const relay = init.method === undefined || init.method.toUpperCase() === "GET" ? getListRelay() : undefined;
  const host = hostOf(url);

  let relayWhy: string | null = null;
  if (relay !== undefined && host !== undefined && relayFirstFor(host)) {
    const outcome = await viaRelay(relay, url, timeoutMs, 2);
    if ("response" in outcome) return outcome.response;
    relayWhy = outcome.why;
  }

  let response: Response;
  try {
    response = await respondingWithin(timeoutMs, (signal) => fetch(url, { ...init, signal }));
  } catch (error) {
    if (relay === undefined || host === undefined) throw error;
    const outcome = await viaRelay(relay, url, timeoutMs, 3);
    if ("response" in outcome) {
      markRelayFirst(host);
      return outcome.response;
    }
    throw withRelayNote(error, outcome.why ?? relayWhy);
  }

  // The provider answered, but with a refusal that a different address may not get (the viewer's network or ISP is blocked):
  // try the relay, and if it cannot do better the provider's own answer stands and is what gets reported.
  if (relay !== undefined && host !== undefined && REFUSAL_STATUSES.has(response.status)) {
    const outcome = await viaRelay(relay, url, timeoutMs, 2);
    if ("response" in outcome) {
      await response.body?.cancel().catch(() => undefined);
      markRelayFirst(host);
      return outcome.response;
    }
  }
  return response;
}
