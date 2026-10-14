import { SyncClient } from "@testcard/core/src/sync/client.ts";
import { decryptCredentials } from "@testcard/core/src/sync/credentialCrypto.ts";
import type { SourceCredentialsPayload } from "@testcard/sync-schema";
import { Library } from "./library.ts";
import { openProfiles, prefixOf, type WebProfile } from "./profiles.ts";
import type { XtreamLogin } from "./xtream.ts";

/** A source as the web player uses it: an Xtream login, or a playlist address. Both come from the account's encrypted record. */
export type WebSource =
  | { readonly kind: "xtream"; readonly id: string; readonly label: string; readonly login: XtreamLogin; readonly keyHost: string }
  | { readonly kind: "m3u"; readonly id: string; readonly label: string; readonly playlistUrl: string };

/** What the server said, when it said something short (it replies in JSON with a message). */
function serverSays(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  try {
    const said = (JSON.parse(text) as { message?: unknown; error?: unknown }).message ?? (JSON.parse(text) as { error?: unknown }).error;
    return typeof said === "string" && said.length < 120 ? ` (${said})` : "";
  } catch {
    return "";
  }
}

/** The words for a sign-in or sync failure. */
export function plainReason(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return "That email or password was not accepted.";
  if (status === 403) return `Testcard refused this page's request${serverSays(error)}. If you are running a local copy, its address may need allowing.`;
  if (status === 429) return "Too many tries. Wait a few minutes and try again.";
  if (error instanceof DOMException && error.name === "OperationError") return "Your sources could not be opened with that password.";
  if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) return "Could not reach Testcard. Check your connection and try again.";
  return error instanceof Error && error.message !== "" ? error.message : "Something went wrong. Try again.";
}

const asSource = (id: string, label: string, payload: SourceCredentialsPayload): WebSource & { position: number } =>
  "playlistUrl" in payload
    ? { kind: "m3u", id, label, playlistUrl: payload.playlistUrl, position: payload.position ?? 0 }
    : { kind: "xtream", id, label, login: { host: payload.host, username: payload.username, password: payload.password }, keyHost: payload.keyHost ?? payload.host, position: payload.position ?? 0 };

/** A signed-in account: its sources and profiles, opened with the password, and a way to open a profile's library. */
export interface Account {
  readonly sources: WebSource[];
  readonly profiles: WebProfile[];
  openLibrary(profileId: string): Promise<Library>;
}

/**
 * Signs in with the account and opens its sources and profiles in the browser: the server only ever holds them sealed, and the
 * key is made from the password here. The session cookie this sets is what lets the stream proxy know who is asking. The
 * password is not kept; nothing is written to browser storage.
 */
export async function signInAndLoad(email: string, password: string): Promise<Account> {
  let token: string | undefined;
  const client = new SyncClient({ baseUrl: location.origin, getSessionToken: () => token });
  token = (await client.signIn(email, password)).sessionToken;
  const salt = await client.getSalt();
  if (salt === undefined) throw new Error("This account has no sources yet. Add one in the app first.");
  const pulled = await client.pull(0);
  const opened: (WebSource & { position: number })[] = [];
  for (const row of pulled.sources) {
    if (row.deletedAt !== null || row.credentialsBlob === null || row.credentialsIv === null || row.label === null) continue;
    opened.push(asSource(row.remoteKey, row.label, await decryptCredentials({ blob: row.credentialsBlob, iv: row.credentialsIv }, password, salt)));
  }
  const sources = opened.sort((a, b) => a.position - b.position).map((entry) => {
    const { position, ...source } = entry;
    void position;
    return source;
  });
  const profiles = await openProfiles(pulled.profiles, password, salt);
  return {
    sources,
    profiles,
    // Main's history came with the first pull; another profile's is its own pull.
    openLibrary: async (profileId) => new Library(client, prefixOf(profileId), profileId === "main" ? pulled : await client.pull(0, profileId)),
  };
}

export async function signOut(): Promise<void> {
  await fetch("/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
}
