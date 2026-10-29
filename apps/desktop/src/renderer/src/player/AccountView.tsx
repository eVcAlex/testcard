import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SyncStatus, SourceListItem } from "../../../shared/ipc.js";
import { Icon } from "../components/Icon.js";
import { EmptyState } from "../components/EmptyState.js";
import { SourceForm, type SourceSection } from "../SourceForm.js";
import { formatRelative } from "../lib/time.js";
import { SourceCard } from "./SourceCard.js";
import { SETUP_CHECK_EVENT } from "./SetupLinkHost.js";
import { SharedLinksPanel } from "./SharedLinksPanel.js";
import { ProfilesPanel } from "./ProfilesPanel.js";
import { UpdatePanel } from "./UpdatePanel.js";

/** Signs a TV in: the TV shows a code, and typing it here hands it this account (the /link page does the same from a phone). */
function LinkTv() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await window.testcard.sync.linkTv(code);
      setCode("");
      setResult({ ok: true, text: "Done. Your TV is signing in." });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "Could not link the TV." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pw-link-tv" onSubmit={(event) => void submit(event)}>
      <label htmlFor="pw-link-code">Sign in a TV</label>
      <p className="pw-panel-note">On the TV choose Sign in with a code, then type the 8-character code it shows.</p>
      <div className="pw-link-row">
        <input
          id="pw-link-code"
          className="input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD 2345"
          autoComplete="off"
          spellCheck={false}
          maxLength={9}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || code.trim() === ""}>
          {busy ? "Linking…" : "Link TV"}
        </button>
      </div>
      {result !== null && <p className={result.ok ? "msg msg--hint" : "msg msg--error"}>{result.text}</p>}
    </form>
  );
}

/** The sync status, refreshed on a slow poll so "Synced 2m ago" stays honest while the page is open. */
export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => window.testcard.sync.status(),
    refetchInterval: 20_000,
  });
}

/** Sign in / create account / signed-in summary. */
function SyncPanel() {
  const query = useSyncStatus();
  const [override, setOverride] = useState<SyncStatus | undefined>();
  const status: SyncStatus = override ?? query.data ?? { account: "signed-out" };
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  // Keep the local override from masking newer polled data once a poll lands after our action.
  useEffect(() => {
    if (query.data !== undefined) setOverride(undefined);
  }, [query.data]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(undefined);
    try {
      const result =
        mode === "signIn" ? await window.testcard.sync.signIn(email, password) : await window.testcard.sync.signUp(email, password);
      setOverride(result);
      setPassword("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "That didn't work. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resume(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(undefined);
    try {
      setOverride(await window.testcard.sync.reenterPassword(password));
      setPassword("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn't resume sync. Check the password.");
    } finally {
      setBusy(false);
    }
  }

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  async function run(action: () => Promise<SyncStatus>): Promise<void> {
    setBusy(true);
    try {
      setOverride(await action());
    } finally {
      setBusy(false);
    }
  }

  if (status.account === "signed-in") {
    const failed = status.lastError !== undefined;
    return (
      <section className="pw-panel">
        <div className="pw-panel-head">
          <h3>Sync</h3>
        </div>
        <div className="pw-sync-summary">
          <span className="pw-sync-avatar" aria-hidden="true">
            {(status.email ?? "?").charAt(0).toUpperCase()}
          </span>
          <div className="pw-sync-who">
            <span className="pw-sync-email">{status.email}</span>
            <span className="pw-sync-state" data-state={busy ? "busy" : failed ? "error" : "ok"}>
              <i aria-hidden="true" />
              {busy
                ? "Syncing…"
                : failed
                  ? "Last sync failed"
                  : status.lastSyncedAt
                    ? `Synced ${formatRelative(status.lastSyncedAt)}`
                    : "Waiting for the first sync"}
            </span>
          </div>
          <div className="pw-sync-actions">
            <button type="button" className="btn btn--ghost" onClick={() => run(() => window.testcard.sync.triggerNow())} disabled={busy}>
              <Icon name="refresh" /> Sync now
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmingSignOut(true)} disabled={busy}>
              Sign out
            </button>
          </div>
        </div>
        {failed && <p className="msg msg--error">{status.lastError}</p>}
        <p className="pw-panel-note">Favourites, watch progress and sources stay in step across every device signed in to this account.</p>
        <LinkTv />
        {confirmingSignOut && (
          <div
            className="pw-confirm-backdrop"
            onClick={() => setConfirmingSignOut(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setConfirmingSignOut(false);
            }}
          >
            <div className="pw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="pw-signout-title" onClick={(event) => event.stopPropagation()}>
              <h3 id="pw-signout-title">Sign out?</h3>
              <p>Syncing stops on this computer until you sign in again. Your sources and favourites stay here.</p>
              <div className="pw-confirm-actions">
                <button type="button" className="btn btn--ghost" autoFocus onClick={() => setConfirmingSignOut(false)}>
                  Stay signed in
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setConfirmingSignOut(false);
                    void run(() => window.testcard.sync.signOut());
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (status.account === "needs-password") {
    return (
      <section className="pw-panel">
        <div className="pw-panel-head">
          <h3>Sync</h3>
        </div>
        <form className="pw-form" onSubmit={resume}>
          <p className="pw-panel-note">
            Signed in as {status.email}. Enter your password to resume syncing on this device.
          </p>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </label>
          {formError && <p className="msg msg--error">{formError}</p>}
          <div className="pw-form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy || password === ""}>
              Resume sync
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="pw-panel">
      <div className="pw-panel-head">
        <h3>Sync</h3>
      </div>
      {status.lastError !== undefined && <p className="msg msg--error">{status.lastError}</p>}
      <div className="pw-auth">
      <div className="pw-auth-pitch">
        <p className="pw-auth-title">Pick up where you left off, on any device</p>
        <ul className="pw-auth-list">
          <li>
            <Icon name="star" size={15} />
            Favourites follow you
          </li>
          <li>
            <Icon name="clock" size={15} />
            Movies and episodes resume at the same spot
          </li>
          <li>
            <Icon name="signal" size={15} />
            Sources come with you; logins are encrypted before they leave this device
          </li>
        </ul>
      </div>
      <div className="pw-auth-form">
      <div className="pw-seg" role="tablist" aria-label="Account">
        <button type="button" role="tab" className="pw-seg-btn" data-active={mode === "signIn"} aria-selected={mode === "signIn"} onClick={() => setMode("signIn")}>
          Sign in
        </button>
        <button type="button" role="tab" className="pw-seg-btn" data-active={mode === "signUp"} aria-selected={mode === "signUp"} onClick={() => setMode("signUp")}>
          Create account
        </button>
      </div>
      <form className="pw-form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {mode === "signUp" && (
          <p className="msg msg--hint">
            Your password also locks your provider logins before they leave this device. If you forget it you can reset it by email, but your saved sources are then cleared and have to be put back from a device that still has them. Keep it somewhere safe.
          </p>
        )}
        {mode === "signIn" && (
          <p className="msg msg--hint">
            <a href="https://evicted.dev/reset" target="_blank" rel="noreferrer">Forgot your password?</a>
          </p>
        )}
        {formError && <p className="msg msg--error">{formError}</p>}
        <div className="pw-form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || email === "" || password === ""}>
            {busy ? "Working…" : mode === "signIn" ? "Sign in" : "Create account"}
          </button>
        </div>
      </form>
      </div>
      </div>
    </section>
  );
}

type Pane = { mode: "list" } | { mode: "add" } | { mode: "link" } | { mode: "shared" } | { mode: "edit"; section: SourceSection; source: SourceListItem };

/** Paste a setup link someone sent. The question "add this?" is asked by `SetupLinkHost`, wherever the link came from. */
function SetupLinkForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    window.testcard.setup
      .preview(text)
      .then(() => {
        window.dispatchEvent(new Event(SETUP_CHECK_EVENT));
        onDone();
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "That link couldn't be opened."))
      .finally(() => setBusy(false));
  };
  return (
    <form className="pw-form" onSubmit={submit}>
      <label className="field">
        <span>Setup link</span>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://evicted.dev/s#…" autoComplete="off" spellCheck={false} disabled={busy} />
        <p className="msg msg--hint">Paste the link you were sent. You'll be asked before anything is added.</p>
      </label>
      {error && <p className="msg msg--error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={busy || text.trim() === ""}>{busy ? "Opening…" : "Continue"}</button>
      </div>
    </form>
  );
}

/** Add, edit, refresh and remove the providers this account watches from. */
function SourcesPanel() {
  const [pane, setPane] = useState<Pane>({ mode: "list" });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
    // Poll while an import runs so the card shows its progress and settles when it finishes.
    refetchInterval: (query) => (query.state.data?.some((source) => source.refreshing === true) ? 1500 : false),
  });

  if (pane.mode === "link" || pane.mode === "shared") {
    return (
      <section className="pw-panel">
        <div className="pw-panel-head">
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Back to sources" onClick={() => setPane({ mode: "list" })}>
            <Icon name="back" />
          </button>
          <h3>{pane.mode === "link" ? "Add from a setup link" : "Shared links"}</h3>
        </div>
        <div className="pw-source-form-wrap">
          {pane.mode === "link" ? <SetupLinkForm onDone={() => setPane({ mode: "list" })} /> : <SharedLinksPanel />}
        </div>
      </section>
    );
  }

  if (pane.mode !== "list") {
    return (
      <section className="pw-panel">
        <div className="pw-panel-head">
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Back to sources" onClick={() => setPane({ mode: "list" })}>
            <Icon name="back" />
          </button>
          <h3>{pane.mode === "edit" ? (pane.section === "settings" ? `${pane.source.name} settings` : `Edit ${pane.source.name}`) : "Add source"}</h3>
        </div>
        <div className="pw-source-form-wrap">
          <SourceForm
            {...(pane.mode === "edit" ? { source: pane.source, section: pane.section } : {})}
            onDone={() => setPane({ mode: "list" })}
            onCancel={() => setPane({ mode: "list" })}
          />
        </div>
      </section>
    );
  }

  const list = sources.data ?? [];
  return (
    <section className="pw-panel">
      <div className="pw-panel-head">
        <h3>Sources</h3>
        <button type="button" className="btn btn--ghost pw-panel-action" onClick={() => setPane({ mode: "link" })}>
          Add from a link
        </button>
        {list.length > 0 && (
          <button type="button" className="btn btn--ghost pw-panel-action" onClick={() => setPane({ mode: "shared" })}>
            Shared links
          </button>
        )}
        {list.length > 0 && (
          <button type="button" className="btn btn--ghost pw-panel-action" onClick={() => setPane({ mode: "add" })}>
            <Icon name="plus" /> Add source
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon="signal"
          title="No sources yet"
          hint="Add an Xtream login or an M3U playlist link to start watching."
          action={
            <button type="button" className="btn btn--primary" onClick={() => setPane({ mode: "add" })}>
              <Icon name="plus" /> Add source
            </button>
          }
        />
      ) : (
        <ul className="pw-src-list">
          {list.map((source, index) => (
            <SourceCard
              key={source.id}
              source={source}
              canMoveUp={index > 0}
              canMoveDown={index < list.length - 1}
              onEdit={() => setPane({ mode: "edit", section: "connection", source })}
              onSettings={() => setPane({ mode: "edit", section: "settings", source })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Everything about *you* in one place: the sync account, and the sources that account carries to
 * every device.
 */
export function AccountView() {
  return (
    <main className="pw-account-view pw-main">
      <div className="pw-head">
        <h2>Account</h2>
      </div>
      <div className="pw-scroll">
        <div className="pw-account-col">
          <SyncPanel />
          <ProfilesPanel />
          <UpdatePanel />
          <SourcesPanel />
        </div>
      </div>
    </main>
  );
}
