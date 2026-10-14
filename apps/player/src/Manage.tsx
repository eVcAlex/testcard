import { useState } from "preact/hooks";
import { emptyDraft, serverAddress, type SourceDraft } from "@testcard/core/src/sync/sourceDraft.ts";
import { MAX_PROFILES } from "./account.ts";
import { forgetCatalogue } from "./catalogue.ts";
import { MAIN_PROFILE, PROFILE_COLOURS, pinMatches, type WebProfile } from "./profiles.ts";
import { plainReason, refreshed, type Account } from "./session.ts";
import { call } from "./xtream.ts";

type Editing = { kind: "source"; id: string | undefined } | { kind: "profile"; id: string | undefined } | undefined;

/** A login the provider turns down is refused; one that could not be asked (the proxy is off, the server is out of reach) is kept unchecked. */
async function checkLogin(draft: SourceDraft): Promise<string | undefined> {
  if (draft.kind !== "xtream" || draft.password === "" || draft.server.trim() === "") return undefined;
  try {
    const answer = (await call({ host: serverAddress(draft.server), username: draft.username.trim(), password: draft.password }, "")) as { user_info?: { auth?: number } } | null;
    if (answer?.user_info?.auth === 0) throw new Error("The provider turned down that username and password.");
    return undefined;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The provider turned down")) throw error;
    return `Saved without checking the login (${plainReason(error)}).`;
  }
}

/**
 * Sources and profiles of the account, changed here and picked up by the apps on their next sync. Reached from the "who is
 * watching" screen, so a profile locked with a PIN is not changed by whoever happens to be at the page: its PIN is asked for.
 */
export function Manage({ account, onChanged, onDone, onSignOut }: { account: Account; onChanged: (next: Account) => void; onDone: () => void; onSignOut: () => void }) {
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const { editor } = account;

  const run = async (work: () => Promise<string | void>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const said = await work();
      if (typeof said === "string") setNotice(said);
      forgetCatalogue(); // a source keeps its id through an edit, so what was fetched for it is stale
      onChanged(refreshed(account));
      return true;
    } catch (reason) {
      setError(plainReason(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (editing?.kind === "source") {
    return <SourceForm key={editing.id ?? "new"} initial={editing.id !== undefined ? editor.draftOf(editing.id) : undefined} busy={busy} error={error}
      onCancel={() => { setEditing(undefined); setError(undefined); }}
      onSave={async (draft) => {
        if (await run(async () => {
          const warning = await checkLogin(draft);
          await editor.saveSource(editing.id, draft);
          return warning;
        })) setEditing(undefined);
      }} />;
  }
  if (editing?.kind === "profile") {
    const profile = account.profiles.find((candidate) => candidate.id === editing.id);
    return <ProfileForm key={editing.id ?? "new"} profile={profile} busy={busy} error={error} count={account.profiles.length}
      onCancel={() => { setEditing(undefined); setError(undefined); }}
      onSave={async (change) => { if (await run(() => editor.saveProfile(editing.id, change).then(() => undefined))) setEditing(undefined); }} />;
  }

  return (
    <main class="signin manage">
      <h1>Your account</h1>
      <p class="small">Changes here reach your TV and other devices the next time they sync.</p>
      {notice !== undefined ? <p class="muted" role="status">{notice}</p> : null}
      {error !== undefined ? <p class="problem" role="alert">{error}</p> : null}
      {editor.lockedCount() > 0 ? <p class="small">{editor.lockedCount()} saved item(s) could not be opened with this password and are left as they are.</p> : null}

      <h2>Sources</h2>
      {account.sources.length === 0 ? <p class="muted">No sources yet. Add the login or playlist link from your provider.</p> : null}
      <ul class="rows">
        {account.sources.map((source) => (
          <li key={source.id}>
            <span>{source.label}<small class="muted"> {source.kind === "xtream" ? "Xtream" : "Playlist"}</small></span>
            <button class="quiet" disabled={busy} onClick={() => setEditing({ kind: "source", id: source.id })}>Edit</button>
            <ConfirmRemove disabled={busy} onConfirm={() => void run(() => editor.removeSource(source.id).then(() => undefined))} />
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={() => setEditing({ kind: "source", id: undefined })}>Add a source</button>

      <h2>Profiles</h2>
      <ul class="rows">
        {account.profiles.map((profile) => (
          <li key={profile.id}>
            <span class="avatar small-avatar" style={{ background: PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.length] }}>{profile.name.slice(0, 1).toUpperCase()}</span>
            <span>{profile.name}{profile.pin !== null ? " 🔒" : ""}</span>
            <PinGate profile={profile}>
              <button class="quiet" disabled={busy} onClick={() => setEditing({ kind: "profile", id: profile.id })}>Edit</button>
              {profile.id !== MAIN_PROFILE ? <ConfirmRemove disabled={busy} onConfirm={() => void run(() => editor.removeProfile(profile.id))} /> : null}
            </PinGate>
          </li>
        ))}
      </ul>
      <button disabled={busy || account.profiles.length >= MAX_PROFILES} onClick={() => setEditing({ kind: "profile", id: undefined })}>Add a profile</button>

      <p>
        <button class="quiet" disabled={account.sources.length === 0} onClick={onDone}>{account.sources.length === 0 ? "Add a source to start watching" : "Done"}</button>{" "}
        <button class="quiet" onClick={onSignOut}>Sign out</button>
      </p>
    </main>
  );
}

/** Asks twice: removing a profile takes its history off every device. */
function ConfirmRemove({ onConfirm, disabled }: { onConfirm: () => void; disabled: boolean }) {
  const [sure, setSure] = useState(false);
  if (!sure) return <button class="quiet" disabled={disabled} onClick={() => setSure(true)}>Remove</button>;
  return <><button disabled={disabled} onClick={onConfirm}>Remove for every device</button><button class="quiet" onClick={() => setSure(false)}>Keep</button></>;
}

/** Shows what is inside only once the profile's PIN is right (a profile without one is open). */
function PinGate({ profile, children }: { profile: WebProfile; children: preact.ComponentChildren }) {
  const [open, setOpen] = useState(profile.pin === null);
  const [wrong, setWrong] = useState(false);
  if (open) return <>{children}</>;
  return (
    <form class="inline" onSubmit={(event) => {
      event.preventDefault();
      const digits = String(new FormData(event.currentTarget as HTMLFormElement).get("pin"));
      if (pinMatches(profile, digits)) setOpen(true);
      else setWrong(true);
    }}>
      <input name="pin" type="password" inputMode="numeric" autocomplete="off" placeholder="PIN" aria-label={`${profile.name}'s PIN`} required />
      <button class="quiet" type="submit">Unlock</button>
      {wrong ? <span class="problem" role="alert">Not right.</span> : null}
    </form>
  );
}

function SourceForm({ initial, busy, error, onSave, onCancel }: { initial: SourceDraft | undefined; busy: boolean; error: string | undefined; onSave: (draft: SourceDraft) => void; onCancel: () => void }) {
  const editing = initial !== undefined;
  const [kind, setKind] = useState<SourceDraft["kind"]>(initial?.kind ?? "xtream");
  const [content, setContent] = useState((initial ?? emptyDraft("xtream")).content);
  return (
    <main class="signin manage">
      <h1>{editing ? "Change source" : "Add a source"}</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        const text = (name: string) => String(form.get(name) ?? "");
        onSave({ kind, name: text("name"), server: text("server"), username: text("username"), password: text("password"), playlistUrl: text("playlistUrl"), epgUrl: text("epgUrl"), backupUrls: text("backupUrls"), content });
      }}>
        {!editing ? (
          <label>Type<select value={kind} onChange={(event) => setKind((event.currentTarget as HTMLSelectElement).value as SourceDraft["kind"])}>
            <option value="xtream">Xtream login</option><option value="m3u">Playlist link (M3U)</option>
          </select></label>
        ) : null}
        <label>Name<input name="name" required defaultValue={initial?.name ?? ""} /></label>
        {kind === "xtream" ? (
          <>
            <label>Server address<input name="server" placeholder="http://provider.example:8080" required defaultValue={initial?.server ?? ""} /></label>
            <label>Username<input name="username" autocomplete="off" required defaultValue={initial?.username ?? ""} /></label>
            <label>Password<input name="password" type="password" autocomplete="off" required={!editing} placeholder={editing ? "Leave blank to keep it" : ""} /></label>
            <label>Other server addresses<input name="backupUrls" placeholder="Optional, separated by commas" defaultValue={initial?.backupUrls ?? ""} /></label>
          </>
        ) : (
          <label>Playlist link<input name="playlistUrl" required defaultValue={initial?.playlistUrl ?? ""} placeholder="https://..." /></label>
        )}
        <label>TV guide link<input name="epgUrl" placeholder="Optional (XMLTV)" defaultValue={initial?.epgUrl ?? ""} /></label>
        <fieldset>
          <legend>Load</legend>
          {(["live", "movies", "series"] as const).map((part) => (
            <label class="check"><input type="checkbox" checked={content[part]} onChange={(event) => setContent({ ...content, [part]: (event.currentTarget as HTMLInputElement).checked })} />{part === "live" ? "Live TV" : part === "movies" ? "Movies" : "Series"}</label>
          ))}
        </fieldset>
        {error !== undefined ? <p class="problem" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" class="quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </form>
    </main>
  );
}

function ProfileForm({ profile, busy, error, count, onSave, onCancel }: { profile: WebProfile | undefined; busy: boolean; error: string | undefined; count: number; onSave: (change: { name: string; colour: number }) => void; onCancel: () => void }) {
  const [colour, setColour] = useState(profile?.colour ?? count % PROFILE_COLOURS.length);
  return (
    <main class="signin manage">
      <h1>{profile !== undefined ? "Change profile" : "Add a profile"}</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        onSave({ name: String(new FormData(event.currentTarget as HTMLFormElement).get("name") ?? ""), colour });
      }}>
        <label>Name<input name="name" required maxLength={20} defaultValue={profile?.name ?? ""} /></label>
        <div class="swatches" role="radiogroup" aria-label="Colour">
          {PROFILE_COLOURS.map((value, index) => (
            <button type="button" role="radio" aria-checked={colour === index} aria-label={`Colour ${index + 1}`} class={`avatar swatch${colour === index ? " on" : ""}`} style={{ background: value }} onClick={() => setColour(index)} />
          ))}
        </div>
        {profile?.pin != null ? <p class="small">The PIN stays as it is; change it on a TV.</p> : null}
        {error !== undefined ? <p class="problem" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" class="quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </form>
    </main>
  );
}
