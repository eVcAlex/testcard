import {
  SyncPullResponseSchema,
  SyncPushRequestSchema,
  SyncPushResponseSchema,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@testcard/sync-schema";

export interface SyncClientConfig {
  readonly baseUrl: string;
  /** Read fresh on every call — the token can change between calls (sign-in/out). */
  readonly getSessionToken: () => string | undefined;
}

export interface AuthResult {
  readonly userId: string;
  readonly sessionToken: string;
}

interface BetterAuthEmailResponse {
  readonly user: { readonly id: string };
  readonly token: string;
}

/**
 * Thin `fetch`-based client for `/auth/*` and `/sync/*`. Every response is parsed through its
 * `packages/sync-schema` zod schema before this class hands it back — a shape drift between the
 * Worker and this client fails loudly here instead of surfacing as a confusing UI bug later.
 */
/** A request that has not finished by now is given up on: a stalled connection must not hold the whole sync (and the app's profile picker) forever. */
const REQUEST_TIMEOUT_MS = 15_000;

export class SyncClient {
  private readonly inFlight = new Set<AbortController>();

  constructor(private readonly config: SyncClientConfig) {}

  /** Cancels every request under way, so a caller that must wait for the sync to stop (a profile swap) does not wait on the network. */
  abortAll(): void {
    for (const controller of this.inFlight) controller.abort();
  }

  /**
   * Electron's main process runs fetch() outside any browsing context, so Chromium's network
   * stack sends a literal `Origin: null` rather than omitting the header. better-auth's CSRF
   * check treats a present-but-null Origin as suspicious and rejects it ("Missing or null
   * Origin"), even though it accepts requests with no Origin header at all (e.g. curl). Setting
   * a real Origin matching this client's own baseUrl satisfies the check.
   *
   * Throws on any non-2xx (bar a 404 when `missingIsFine`, which `getSalt` reads as "no salt yet"). The error
   * carries the HTTP `status`, and its message is the server's reply, which `serverMessage` in the sync controller
   * reads for the words to show.
   */
  private async request(path: string, opts: { body?: unknown; authed?: boolean; missingIsFine?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = { Origin: this.config.baseUrl };
    const token = opts.authed === true ? this.config.getSessionToken() : undefined;
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    this.inFlight.add(controller);
    // Left to fire after a quick request is harmless (aborting a finished one does nothing); it also covers reading the body.
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(
        this.config.baseUrl + path,
        opts.body !== undefined ? { method: "POST", headers, body: JSON.stringify(opts.body), signal: controller.signal } : { headers, signal: controller.signal },
      );
      if (res.ok || (res.status === 404 && opts.missingIsFine === true)) return res;
      const reply = await res.text().catch(() => "");
      throw Object.assign(new Error(reply !== "" ? reply : `${res.status} ${res.statusText}`), { status: res.status });
    } finally {
      this.inFlight.delete(controller);
    }
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    // better-auth's core user schema requires `name`; this app has no display-name concept
    // (AccountView only collects email/password), so the email itself stands in for it.
    const res = (await (await this.request("/auth/sign-up/email", { body: { email, password, name: email } })).json()) as BetterAuthEmailResponse;
    return { userId: res.user.id, sessionToken: res.token };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const res = (await (await this.request("/auth/sign-in/email", { body: { email, password } })).json()) as BetterAuthEmailResponse;
    return { userId: res.user.id, sessionToken: res.token };
  }

  async signOut(): Promise<void> {
    await this.request("/auth/sign-out", { body: {}, authed: true });
  }

  /** `profile`: whose favourites, recents and progress to fetch; Main's (unprefixed) when left out. */
  async pull(since: number, profile?: string): Promise<SyncPullResponse> {
    const json = await (await this.request(`/sync/pull?since=${since}${profile !== undefined ? `&profile=${encodeURIComponent(profile)}` : ""}`, { authed: true })).json();
    return SyncPullResponseSchema.parse(json);
  }

  /** Fetches this account's PBKDF2 salt (set once at sign-up). Undefined if none is set yet. */
  async getSalt(): Promise<string | undefined> {
    const res = await this.request("/sync/salt", { authed: true, missingIsFine: true });
    if (res.status === 404) return undefined;
    return ((await res.json()) as { salt: string }).salt;
  }

  /** Set-once — call only right after `signUp`, with a freshly generated salt. */
  async setSalt(salt: string): Promise<void> {
    await this.request("/sync/salt", { body: { salt }, authed: true });
  }

  /** Tells the Worker a public guide address, so its daily job builds a small file for it. Answers the file's name. */
  async registerGuide(url: string): Promise<string> {
    return ((await (await this.request("/guides/register", { body: { url }, authed: true })).json()) as { file: string }).file;
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const body = SyncPushRequestSchema.parse(request);
    const json = await (await this.request("/sync/push", { body, authed: true })).json();
    return SyncPushResponseSchema.parse(json);
  }
}
