import { deriveLinkLookup, generateLinkCode, generateLinkSalt, openLinkSecrets, type LinkSecrets } from "./linkCrypto.js";

/** The TV's side of signing in with a code: ask the server for a session, show the code, wait for the page to answer. */
export interface LinkSession {
  /** Eight characters, as shown (with a dash added for reading). */
  readonly code: string;
  /** Epoch ms when the server forgets the code. */
  readonly expiresAt: number;
  /** Resolves with the person's sign-in once the page has sent it. Rejects with `LinkExpiredError` when the code runs out. */
  waitForApproval(signal: AbortSignal): Promise<LinkSecrets>;
}

export class LinkExpiredError extends Error {
  constructor() {
    super("The code ran out.");
    this.name = "LinkExpiredError";
  }
}

export interface LinkOptions {
  readonly fetch?: typeof fetch;
  /** How often to ask whether the page has answered. */
  readonly pollEveryMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

export async function startLinkSession(baseUrl: string, options: LinkOptions = {}): Promise<LinkSession> {
  const doFetch = options.fetch ?? fetch;
  const pollEveryMs = options.pollEveryMs ?? 2000;
  const sleep = options.sleep ?? wait;
  const code = generateLinkCode();
  const salt = generateLinkSalt();
  const lookup = await deriveLinkLookup(code);

  const started = await doFetch(`${baseUrl}/link/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookup, salt }) });
  // 409 is the one-in-a-trillion case of a live code that is already taken: the caller just asks again.
  if (!started.ok) throw new Error(started.status === 409 ? "Try again." : "Could not reach Testcard.");
  const { expiresAt } = (await started.json()) as { expiresAt: number };

  return {
    code,
    expiresAt,
    async waitForApproval(signal) {
      for (;;) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        let reply: Response | undefined;
        try {
          reply = await doFetch(`${baseUrl}/link/poll?lookup=${encodeURIComponent(lookup)}`, { signal });
        } catch {
          // A dropped connection is not the end: the next poll tries again, until the code runs out.
        }
        if (reply?.status === 404) throw new LinkExpiredError();
        if (reply?.ok) {
          const body = (await reply.json()) as { status: string; blob?: string; iv?: string };
          if (body.status === "ready" && body.blob !== undefined && body.iv !== undefined) return openLinkSecrets({ blob: body.blob, iv: body.iv }, code, salt);
        }
        if ((options.now ?? Date.now)() >= expiresAt) throw new LinkExpiredError();
        await sleep(pollEveryMs, signal);
      }
    },
  };
}
