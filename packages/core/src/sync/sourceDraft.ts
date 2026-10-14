import type { SourceContent } from "@testcard/sync-schema";

/**
 * The rules for a source typed into a form, shared by the TV and the website. No database and no network here: a
 * caller that can reach the provider checks the login itself. Every function throws a message fit to show.
 */

/** A source as the form edits it. `password` is blank while editing unless a new one is typed. */
export interface SourceDraft {
  readonly kind: "xtream" | "m3u";
  readonly name: string;
  readonly server: string;
  readonly username: string;
  readonly password: string;
  /** A playlist link; for a new source, a whole Xtream `get.php` link is taken as its login. */
  readonly playlistUrl: string;
  readonly epgUrl: string;
  /** Xtream: other server addresses for the same account, comma or space separated as typed. */
  readonly backupUrls: string;
  readonly content: SourceContent;
}

export const emptyDraft = (kind: SourceDraft["kind"]): SourceDraft => ({
  kind,
  name: "",
  server: "",
  username: "",
  password: "",
  playlistUrl: "",
  epgUrl: "",
  backupUrls: "",
  content: { live: true, movies: true, series: true },
});

/** Just the scheme and host of a server address, so a whole pasted provider link still works. */
export function serverAddress(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error("That's not a server address.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("A server address starts with http:// or https://.");
  return `${parsed.protocol}//${parsed.host}`;
}

/** The playlist link, trimmed, if it is an http(s) address. Whether it answers is the caller's to check. */
export function playlistAddress(input: string): string {
  const url = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That's not a playlist link.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("A playlist link starts with http:// or https://.");
  return url;
}

/** The TV guide address, or null when left empty. */
export function guideAddress(input: string): string | null {
  const url = input.trim();
  if (url === "") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // falls through
  }
  throw new Error("The TV guide address must be a link starting with http:// or https://.");
}

/** Backup server addresses as typed (comma or space separated), each reduced to scheme and host, without repeats. */
export function backupAddresses(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .filter((entry) => entry !== "")
        .map((entry) => {
          try {
            return serverAddress(entry);
          } catch {
            throw new Error(`"${entry}" is not a server address.`);
          }
        }),
    ),
  ];
}

/** The checks every draft needs before it is kept, whatever the kind. */
export function checkDraftBasics(draft: SourceDraft): { name: string; epgUrl: string | null; backups: string[] } {
  const name = draft.name.trim();
  if (name === "") throw new Error("Give the source a name.");
  if (!draft.content.live && !draft.content.movies && !draft.content.series) throw new Error("Choose at least one of Live TV, Movies and Series.");
  return { name, epgUrl: guideAddress(draft.epgUrl), backups: backupAddresses(draft.backupUrls) };
}
