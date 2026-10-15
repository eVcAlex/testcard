import { SyncClient } from "@testcard/core/src/sync/client.ts";
import { forgetKey, generateSalt } from "@testcard/core/src/sync/credentialCrypto.ts";
import { AccountEditor } from "./account.ts";
import { Library } from "./library.ts";
import { prefixOf, type WebProfile } from "./profiles.ts";
import type { XtreamLogin } from "./xtream.ts";

/** A source as the web player uses it: an Xtream login, or a playlist address. Both come from the account's encrypted record. */
export type WebSource =
  | { readonly kind: "xtream"; readonly id: string; readonly label: string; readonly login: XtreamLogin; readonly keyHost: string }
  | { readonly kind: "m3u"; readonly id: string; readonly label: string; readonly playlistUrl: string };

/** The words for a sign-in or sync failure. */
export function plainReason(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return "That email or password was not accepted.";
  if (status === 429) return "Too many tries. Wait a few minutes and try again.";
  if (error instanceof DOMException && error.name === "OperationError") return "Your sources could not be opened with that password.";
  if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) return "Could not reach Testcard. Check your connection and try again.";
  return error instanceof Error && error.message !== "" ? error.message : "Something went wrong. Try again.";
}

/** A signed-in account: its sources and profiles, opened with the password, and a way to open a profile's library. */
export interface Account {
  readonly sources: WebSource[];
  readonly profiles: WebProfile[];
  /** Adds, changes and removes sources and profiles; `refreshed` then gives the account's new lists. */
  readonly editor: AccountEditor;
  openLibrary(profileId: string): Promise<Library>;
}

/** The account as it is now, after the editor changed something. */
export const refreshed = (account: Account): Account => ({ ...account, sources: account.editor.sources(), profiles: account.editor.profiles() });

/**
 * Signs in with the account and opens its sources and profiles in the browser: the server only ever holds them sealed, and the
 * key is made from the password here. The session cookie this sets is what lets the stream proxy know who is asking. The
 * password stays in this page's memory while signed in (the editor seals changes with it) and goes on sign-out; nothing is
 * written to browser storage.
 */
export async function signInAndLoad(email: string, password: string): Promise<Account> {
  let token: string | undefined;
  const client = new SyncClient({ baseUrl: location.origin, getSessionToken: () => token });
  token = (await client.signIn(email, password)).sessionToken;
  let salt = await client.getSalt();
  if (salt === undefined) {
    // An account made before any device has its salt: set one (set-once, so another device getting there first is fine).
    const fresh = generateSalt();
    try {
      await client.setSalt(fresh);
      salt = fresh;
    } catch (error) {
      if ((error as { status?: unknown }).status !== 409) throw error;
      salt = await client.getSalt();
    }
    if (salt === undefined) throw new Error("Could not set up this account. Try again.");
  }
  const pulled = await client.pull(0);
  const editor = await AccountEditor.open(client, password, salt, pulled);
  return {
    sources: editor.sources(),
    profiles: editor.profiles(),
    editor,
    // Main's history came with the first pull; another profile's is its own pull.
    openLibrary: async (profileId) => new Library(client, prefixOf(profileId), profileId === "main" ? pulled : await client.pull(0, profileId)),
  };
}

export async function signOut(): Promise<void> {
  forgetKey();
  await fetch("/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
}
