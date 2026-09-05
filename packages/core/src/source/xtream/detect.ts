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
