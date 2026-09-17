import wretch, { type Wretch } from "wretch";
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
 * Thin `wretch`-based client for `/auth/*` and `/sync/*`. Every response is parsed through its
 * `packages/sync-schema` zod schema before this class hands it back — a shape drift between the
 * Worker and this client fails loudly here instead of surfacing as a confusing UI bug later.
 */
export class SyncClient {
  private readonly api: Wretch;

  constructor(private readonly config: SyncClientConfig) {
    this.api = wretch(config.baseUrl);
  }

  private authed(): Wretch {
    const token = this.config.getSessionToken();
    return token !== undefined ? this.api.auth(`Bearer ${token}`) : this.api;
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const res = (await this.api.url("/auth/sign-up/email").post({ email, password }).json()) as BetterAuthEmailResponse;
    return { userId: res.user.id, sessionToken: res.token };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const res = (await this.api.url("/auth/sign-in/email").post({ email, password }).json()) as BetterAuthEmailResponse;
    return { userId: res.user.id, sessionToken: res.token };
  }

  async signOut(): Promise<void> {
    await this.authed().url("/auth/sign-out").post({}).res();
  }

  async pull(since: number): Promise<SyncPullResponse> {
    const json = await this.authed().url(`/sync/pull?since=${since}`).get().json();
    return SyncPullResponseSchema.parse(json);
  }

  /** Fetches this account's PBKDF2 salt (set once at sign-up). Undefined if none is set yet. */
  async getSalt(): Promise<string | undefined> {
    try {
      const res = await this.authed().url("/sync/salt").get().res();
      if (res.status === 404) return undefined;
      const json = (await res.json()) as { salt: string };
      return json.salt;
    } catch (e: any) {
      if (e?.status === 404) return undefined;
      throw e;
    }
  }

  /** Set-once — call only right after `signUp`, with a freshly generated salt. */
  async setSalt(salt: string): Promise<void> {
    await this.authed().url("/sync/salt").post({ salt }).res();
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const body = SyncPushRequestSchema.parse(request);
    const json = await this.authed().url("/sync/push").post(body).json();
    return SyncPushResponseSchema.parse(json);
  }
}
