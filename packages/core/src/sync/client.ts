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
export class SyncClient {
  constructor(private readonly config: SyncClientConfig) {}

  /**
   * Electron's main process runs fetch() outside any browsing context, so Chromium's network
   * stack sends a literal `Origin: null` rather than omitting the header. better-auth's CSRF
   * check treats a present-but-null Origin as suspicious and rejects it ("Missing or null
   * Origin"), even though it accepts requests with no Origin header at all (e.g. curl). Setting
   * a real Origin matching this client's own baseUrl satisfies the check.
   *
   * Throws on any non-2xx except 404, which `getSalt` reads as "no salt yet".
   */
  private async request(path: string, opts: { body?: unknown; authed?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = { Origin: this.config.baseUrl };
    const token = opts.authed === true ? this.config.getSessionToken() : undefined;
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(
      this.config.baseUrl + path,
      opts.body !== undefined ? { method: "POST", headers, body: JSON.stringify(opts.body) } : { headers },
    );
    if (!res.ok && res.status !== 404) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { status: res.status });
    return res;
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

  async pull(since: number): Promise<SyncPullResponse> {
    const json = await (await this.request(`/sync/pull?since=${since}`, { authed: true })).json();
    return SyncPullResponseSchema.parse(json);
  }

  /** Fetches this account's PBKDF2 salt (set once at sign-up). Undefined if none is set yet. */
  async getSalt(): Promise<string | undefined> {
    const res = await this.request("/sync/salt", { authed: true });
    if (res.status === 404) return undefined;
    return ((await res.json()) as { salt: string }).salt;
  }

  /** Set-once — call only right after `signUp`, with a freshly generated salt. */
  async setSalt(salt: string): Promise<void> {
    await this.request("/sync/salt", { body: { salt }, authed: true });
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const body = SyncPushRequestSchema.parse(request);
    const json = await (await this.request("/sync/push", { body, authed: true })).json();
    return SyncPushResponseSchema.parse(json);
  }
}
