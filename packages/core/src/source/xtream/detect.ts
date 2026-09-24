/**
 * Given a URL a user pasted in — either a `get.php` M3U link or a raw stream URL copied out
 * of one (both of which Xtream Codes panels hand out), work out whether there's an Xtream
 * backend behind it and extract the credentials to talk to `player_api.php` directly.
 *
 * `player_api.php` is far cheaper than re-parsing the M3U on every refresh (structured JSON,
 * built-in categories, per-channel EPG) so this is the primary source path — see ADR context
 * in CONTEXT.md. M3U parsing (`source/m3u`) remains the fallback for providers this can't
 * detect credentials for.
 */

export interface XtreamCredentials {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
}

/**
 * Extracts credentials without any network call. Handles two shapes seen in the wild:
 *  - `http://host:port/get.php?username=U&password=P&type=m3u_plus`
 *  - `http://host/U/P/<optional-token>/<id>.ts` (a raw stream/playlist URL)
 * Returns null when neither shape matches.
 */
export function extractXtreamCredentials(url: string): XtreamCredentials | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const username = parsed.searchParams.get("username");
  const password = parsed.searchParams.get("password");
  if (username && password) {
    return { baseUrl: `${parsed.protocol}//${parsed.host}`, username, password };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const [pathUser, pathPass] = segments;
    if (pathUser && pathPass) {
      return { baseUrl: `${parsed.protocol}//${parsed.host}`, username: pathUser, password: pathPass };
    }
  }

  return null;
}

export interface XtreamAuthResult {
  readonly authenticated: boolean;
  readonly serverInfo?: Record<string, unknown>;
}

/** Confirms the credentials work against `player_api.php` with no `action` (an auth check). */
export async function probeXtream(
  credentials: XtreamCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<XtreamAuthResult> {
  const url = new URL(`${credentials.baseUrl}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);

  const response = await fetchImpl(url.toString(), { method: "GET" });
  if (!response.ok) return { authenticated: false };

  const body = (await response.json().catch(() => null)) as
    | { user_info?: { auth?: number }; server_info?: Record<string, unknown> }
    | null;

  const authenticated = body?.user_info?.auth === 1;
  return authenticated
    ? { authenticated, ...(body?.server_info !== undefined ? { serverInfo: body.server_info } : {}) }
    : { authenticated: false };
}

/** What an Xtream provider says about the account itself: when it ends and how many streams it may run at once. */
export interface XtreamAccount {
  /** Unix ms; null when the provider gives none (an account that does not expire). */
  readonly expiresAt: number | null;
  readonly maxConnections: number | null;
  readonly activeConnections: number | null;
  /** The provider's word for it: "Active", "Expired", "Banned", "Disabled"... */
  readonly status: string | null;
  readonly trial: boolean;
}

const numberOrNull = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The account's `user_info` from `player_api.php`. Null when the provider does not answer with one. */
export async function fetchXtreamAccount(credentials: XtreamCredentials, fetchImpl: typeof fetch = fetch): Promise<XtreamAccount | null> {
  const url = new URL(`${credentials.baseUrl}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  const response = await fetchImpl(url.toString(), { method: "GET" });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { user_info?: Record<string, unknown> } | null;
  const info = body?.user_info;
  if (info === undefined || info === null || typeof info !== "object") return null;
  const expires = numberOrNull(info["exp_date"]);
  return {
    expiresAt: expires !== null && expires > 0 ? expires * 1000 : null,
    maxConnections: numberOrNull(info["max_connections"]),
    activeConnections: numberOrNull(info["active_cons"]),
    status: typeof info["status"] === "string" && info["status"] !== "" ? info["status"] : null,
    trial: info["is_trial"] === "1" || info["is_trial"] === 1,
  };
}
