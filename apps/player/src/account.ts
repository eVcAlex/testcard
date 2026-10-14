import { decryptJson, encryptJson } from "@testcard/core/src/sync/credentialCrypto.ts";
import { remoteKeyFor, remoteKeyForPlaylist } from "@testcard/core/src/sync/remoteKey.ts";
import { checkDraftBasics, playlistAddress, serverAddress, type SourceDraft } from "@testcard/core/src/sync/sourceDraft.ts";
import { extractXtreamCredentials } from "@testcard/core/src/source/xtream/detect.ts";
import { PROFILE_ID_PATTERN, ProfilePayloadSchema, SourceCredentialsPayloadSchema, type SyncProfile, type SyncPullResponse, type SyncPushRequest, type SyncSource } from "@testcard/sync-schema";
import { MAIN_PROFILE, type WebProfile } from "./profiles.ts";
import type { WebSource } from "./session.ts";

/**
 * Changing the account's sources and profiles from the browser. Everything the server holds is sealed, so a change is
 * made on the decrypted record and sealed again here. Two rules keep it from hurting what other devices wrote:
 *
 * - A record is edited as the raw object it was sealed from, never as its parsed shape (which drops what this build
 *   does not know: pins, hidden categories, skips, a PIN, and whatever a newer app adds).
 * - The account is read again just before each save, so a pin or a hide made on a TV while this page was open is not
 *   written over (the newest write wins on the whole record).
 *
 * A record that cannot be opened is left alone: shown as locked and never sent.
 */

type Raw = Record<string, unknown>;

/** What the editor needs of the sync client, so a test can stand in for it. */
export interface AccountClient {
  pull(since: number): Promise<SyncPullResponse>;
  push(request: SyncPushRequest): Promise<{ newCursor: number }>;
}

interface Held {
  readonly updatedAt: number;
  /** The decrypted record, or null for a removed one or one that would not open. */
  readonly raw: Raw | null;
  readonly label: string | null;
  readonly locked: boolean;
}

/** At most this many people on an account, as in the apps. */
export const MAX_PROFILES = 4;

/** A new profile's id: not a name. Letters and digits only (it is part of the sync keys). Same shape as core's `newProfileId`. */
export const newProfileId = (): string => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const emptyPush = (over: Partial<SyncPushRequest>): SyncPushRequest => ({
  sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], profiles: [], channelFavourites: [], channelRecents: [], ...over,
});

export class AccountEditor {
  private readonly sourceRows = new Map<string, Held>();
  private readonly profileRows = new Map<string, Held>();
  private cursor = 0;

  private constructor(
    private readonly client: AccountClient,
    private readonly password: string,
    private readonly salt: string,
  ) {}

  static async open(client: AccountClient, password: string, salt: string, pulled: SyncPullResponse): Promise<AccountEditor> {
    const editor = new AccountEditor(client, password, salt);
    await editor.take(pulled);
    return editor;
  }

  /** Takes in what a pull returned: a row is replaced only by a newer one. */
  private async take(pulled: SyncPullResponse): Promise<void> {
    this.cursor = Math.max(this.cursor, pulled.serverCursor);
    for (const row of pulled.sources) {
      if (!this.newer(this.sourceRows, row.remoteKey, row.updatedAt)) continue;
      const live = row.deletedAt === null && row.credentialsBlob !== null && row.credentialsIv !== null && row.label !== null;
      this.sourceRows.set(row.remoteKey, live ? await this.open_(row.credentialsBlob as string, row.credentialsIv as string, row.updatedAt, row.label) : { updatedAt: row.updatedAt, raw: null, label: null, locked: false });
    }
    for (const row of pulled.profiles) {
      if (!this.newer(this.profileRows, row.remoteKey, row.updatedAt)) continue;
      const live = row.deletedAt === null && row.blob !== null && row.iv !== null;
      this.profileRows.set(row.remoteKey, live ? await this.open_(row.blob as string, row.iv as string, row.updatedAt, null) : { updatedAt: row.updatedAt, raw: null, label: null, locked: false });
    }
  }

  private newer(rows: Map<string, Held>, key: string, updatedAt: number): boolean {
    const held = rows.get(key);
    return held === undefined || updatedAt > held.updatedAt;
  }

  private async open_(blob: string, iv: string, updatedAt: number, label: string | null): Promise<Held> {
    try {
      const raw = await decryptJson({ blob, iv }, this.password, this.salt);
      if (isRaw(raw)) return { updatedAt, raw, label, locked: false };
    } catch {
      // falls through: shown as locked
    }
    return { updatedAt, raw: null, label, locked: true };
  }

  private async refresh(): Promise<void> {
    await this.take(await this.client.pull(this.cursor));
  }

  /** How many records could not be opened (a different password, or a record this build cannot read). Left as they are. */
  lockedCount(): number {
    return [...this.sourceRows.values(), ...this.profileRows.values()].filter((held) => held.locked).length;
  }

  sources(): WebSource[] {
    const out: (WebSource & { position: number })[] = [];
    for (const [id, held] of this.sourceRows) {
      const parsed = held.raw === null || held.label === null ? undefined : SourceCredentialsPayloadSchema.safeParse(held.raw);
      if (parsed === undefined || !parsed.success || held.label === null) continue;
      const payload = parsed.data;
      out.push(
        "playlistUrl" in payload
          ? { kind: "m3u", id, label: held.label, playlistUrl: payload.playlistUrl, position: payload.position ?? 0 }
          : { kind: "xtream", id, label: held.label, login: { host: payload.host, username: payload.username, password: payload.password }, keyHost: payload.keyHost ?? payload.host, position: payload.position ?? 0 },
      );
    }
    return out.sort((a, b) => a.position - b.position).map(({ position, ...source }) => (void position, source));
  }

  /** Every profile, Main first. Main always exists even when the account never saved a record for it. */
  profiles(): WebProfile[] {
    const found: WebProfile[] = [];
    for (const [id, held] of this.profileRows) {
      const parsed = held.raw === null ? undefined : ProfilePayloadSchema.safeParse(held.raw);
      if (parsed?.success) found.push({ id, ...parsed.data });
    }
    const main = found.find((profile) => profile.id === MAIN_PROFILE) ?? { id: MAIN_PROFILE, name: "Main", colour: 0, avatar: null, pin: null, position: 0 };
    return [main, ...found.filter((profile) => profile.id !== MAIN_PROFILE).sort((a, b) => a.position - b.position)];
  }

  /** The form's starting values for a source being changed. The password is blank: leaving it blank keeps it. */
  draftOf(id: string): SourceDraft | undefined {
    const raw = this.sourceRows.get(id)?.raw;
    const label = this.sourceRows.get(id)?.label;
    if (raw === undefined || raw === null || label === undefined || label === null) return undefined;
    const content = isRaw(raw.content) ? raw.content : {};
    const flag = (name: string) => content[name] !== false;
    const base = { name: label, password: "", epgUrl: typeof raw.epgUrl === "string" ? raw.epgUrl : "", content: { live: flag("live"), movies: flag("movies"), series: flag("series") } };
    if (typeof raw.playlistUrl === "string") return { ...base, kind: "m3u", server: "", username: "", playlistUrl: raw.playlistUrl, backupUrls: "" };
    return {
      ...base,
      kind: "xtream",
      server: String(raw.host ?? ""),
      username: String(raw.username ?? ""),
      playlistUrl: "",
      backupUrls: Array.isArray(raw.backupHosts) ? raw.backupHosts.join(", ") : "",
    };
  }

  /** Adds a source (`id` undefined) or changes one. Throws a message fit to show. Returns the source's id. */
  async saveSource(id: string | undefined, draft: SourceDraft): Promise<string> {
    const { name, epgUrl, backups } = checkDraftBasics(draft);
    await this.refresh();
    const now = Date.now();

    if (id === undefined) {
      const pasted = draft.kind === "m3u" ? extractXtreamCredentials(draft.playlistUrl.trim()) : null;
      let key: string;
      let payload: Raw;
      if (draft.kind === "xtream" || pasted !== null) {
        const login = pasted !== null ? { host: pasted.baseUrl, username: pasted.username, password: pasted.password } : { host: serverAddress(draft.server), username: draft.username.trim(), password: draft.password };
        if (login.username === "" || login.password === "") throw new Error("Enter the username and password.");
        key = await remoteKeyFor(login.host, "source");
        payload = { ...login, keyHost: login.host, ...(backups.length > 0 ? { backupHosts: backups } : {}) };
      } else {
        const url = playlistAddress(draft.playlistUrl);
        key = await remoteKeyForPlaylist(url);
        payload = { playlistUrl: url };
      }
      const existing = this.sourceRows.get(key);
      if (existing !== undefined && existing.raw !== null) throw new Error("That source is already on this account.");
      if (existing?.locked === true) throw new Error("That source is on this account but could not be opened with this password.");
      const position = Math.max(-1, ...[...this.sourceRows.values()].map((row) => (typeof row.raw?.position === "number" ? row.raw.position : 0))) + 1;
      await this.sendSource(key, name, { ...payload, content: draft.content, epgUrl, position }, Math.max(now, (existing?.updatedAt ?? 0) + 1));
      return key;
    }

    const held = this.sourceRows.get(id);
    if (held === undefined || held.raw === null) throw new Error("This source was removed.");
    const raw = held.raw;
    const before = this.draftOf(id) as SourceDraft;
    // A field the form left as it was is not written: a device takes a field that is present as an instruction, so
    // filling in a default would clear a guide address or backup hosts set on a TV.
    const changes: Raw = {};
    if (draft.epgUrl.trim() !== before.epgUrl) changes.epgUrl = epgUrl;
    if (draft.content.live !== before.content.live || draft.content.movies !== before.content.movies || draft.content.series !== before.content.series) changes.content = draft.content;
    let payload: Raw;
    if (typeof raw.playlistUrl === "string") {
      const typed = draft.playlistUrl.trim();
      if (typed !== raw.playlistUrl && extractXtreamCredentials(typed) !== null) throw new Error("That's an Xtream link. Remove this source and add it again as an Xtream login.");
      payload = { ...raw, playlistUrl: typed === raw.playlistUrl ? raw.playlistUrl : playlistAddress(typed) };
    } else {
      const username = draft.username.trim() || String(raw.username ?? "");
      const password = draft.password !== "" ? draft.password : String(raw.password ?? "");
      if (username === "" || password === "") throw new Error("Enter the username and password.");
      if (draft.backupUrls.trim() !== before.backupUrls) changes.backupHosts = backups;
      // The address history is matched by stays, so a provider that moved keeps its favourites and progress.
      payload = { ...raw, host: draft.server.trim() === before.server ? raw.host : serverAddress(draft.server), username, password, keyHost: raw.keyHost ?? raw.host };
    }
    await this.sendSource(id, name, { ...payload, ...changes }, Math.max(now, held.updatedAt + 1));
    return id;
  }

  async removeSource(id: string): Promise<void> {
    await this.refresh();
    const held = this.sourceRows.get(id);
    if (held === undefined || held.raw === null) return;
    const at = Math.max(Date.now(), held.updatedAt + 1);
    await this.client.push(emptyPush({ sources: [{ remoteKey: id, updatedAt: at, deletedAt: at, label: null, credentialsBlob: null, credentialsIv: null }] }));
    this.sourceRows.set(id, { updatedAt: at, raw: null, label: null, locked: false });
  }

  private async sendSource(key: string, label: string, payload: Raw, at: number): Promise<void> {
    if (!SourceCredentialsPayloadSchema.safeParse(payload).success) throw new Error("That source is missing something. Check the address and login.");
    const sealed = await encryptJson(payload, this.password, this.salt);
    const row: SyncSource = { remoteKey: key, updatedAt: at, deletedAt: null, label, credentialsBlob: sealed.blob, credentialsIv: sealed.iv };
    await this.client.push(emptyPush({ sources: [row] }));
    this.sourceRows.set(key, { updatedAt: at, raw: payload, label, locked: false });
  }

  /** Adds a profile (`id` undefined) or renames and recolours one. Its PIN, avatar and place are left as they were. */
  async saveProfile(id: string | undefined, change: { name: string; colour: number }): Promise<string> {
    const name = change.name.trim();
    if (name === "") throw new Error("Give the profile a name.");
    await this.refresh();
    const profileId = id ?? newProfileId();
    if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error("That profile cannot be changed here.");
    const held = this.profileRows.get(profileId);
    if (held?.locked === true) throw new Error("That profile could not be opened with this password.");
    // Counted from the account's live records, not from the ones this build can read.
    const live = new Set([MAIN_PROFILE, ...[...this.profileRows].filter(([, row]) => row.raw !== null || row.locked).map(([key]) => key)]);
    if (!live.has(profileId) && live.size >= MAX_PROFILES) throw new Error(`An account has up to ${MAX_PROFILES} profiles.`);
    const position = Math.max(0, ...this.profiles().map((profile) => profile.position)) + 1;
    const base: Raw = held?.raw ?? { avatar: null, pin: null, position: profileId === MAIN_PROFILE ? 0 : position };
    const payload: Raw = { ...base, name, colour: change.colour };
    const at = Math.max(Date.now(), (held?.updatedAt ?? 0) + 1);
    const sealed = await encryptJson(payload, this.password, this.salt);
    const row: SyncProfile = { remoteKey: profileId, updatedAt: at, deletedAt: null, blob: sealed.blob, iv: sealed.iv };
    await this.client.push(emptyPush({ profiles: [row] }));
    this.profileRows.set(profileId, { updatedAt: at, raw: payload, label: null, locked: false });
    return profileId;
  }

  /** Removes a profile for everyone on the account: a tombstone, which devices take as the TV's own delete. Never Main. */
  async removeProfile(id: string): Promise<void> {
    if (id === MAIN_PROFILE) throw new Error("The main profile cannot be removed.");
    await this.refresh();
    const held = this.profileRows.get(id);
    if (held === undefined || held.raw === null) return;
    const at = Math.max(Date.now(), held.updatedAt + 1);
    await this.client.push(emptyPush({ profiles: [{ remoteKey: id, updatedAt: at, deletedAt: at, blob: null, iv: null }] }));
    this.profileRows.set(id, { updatedAt: at, raw: null, label: null, locked: false });
  }
}
