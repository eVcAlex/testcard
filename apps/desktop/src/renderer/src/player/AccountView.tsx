import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SyncStatus, SourceListItem } from "../../../shared/ipc.js";
import { Icon } from "../components/Icon.js";
import { EmptyState } from "../components/EmptyState.js";
import { SourceForm, type SourceSection } from "../SourceForm.js";
import { formatRelative } from "../lib/time.js";
import { SourceCard } from "./SourceCard.js";
import { UpdatePanel } from "./UpdatePanel.js";

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
            <button type="button" className="btn btn--ghost" onClick={() => run(() => window.testcard.sync.signOut())} disabled={busy}>
              Sign out
            </button>
          </div>
        </div>
        {failed && <p className="msg msg--error">{status.lastError}</p>}
        <p className="pw-panel-note">Favourites, watch progress and sources stay in step across every device signed in to this account.</p>
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
            Your password also locks your provider logins before they leave this device, so it can't be reset. Keep it somewhere safe.
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

type Pane = { mode: "list" } | { mode: "add" } | { mode: "edit"; section: SourceSection; source: SourceListItem };

/** Add, edit, refresh and remove the providers this account watches from. */
function SourcesPanel() {
  const [pane, setPane] = useState<Pane>({ mode: "list" });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
    // Poll while an import runs so the card shows its progress and settles when it finishes.
    refetchInterval: (query) => (query.state.data?.some((source) => source.refreshing === true) ? 1500 : false),
  });

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
          {list.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
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
          <UpdatePanel />
          <SourcesPanel />
        </div>
      </div>
    </main>
  );
}
