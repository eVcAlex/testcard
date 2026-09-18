import { useEffect, useState } from "react";
import type { SyncStatus } from "../../../shared/ipc.js";

/**
 * Sign up / sign in / sign out, plus current sync status. Deliberately minimal — this is the
 * account gate for device sync (see the design spec), not a settings page: it shows account
 * state and one manual "Sync now" action, nothing else.
 */
export function AccountView() {
  const [status, setStatus] = useState<SyncStatus>({ account: "signed-out" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reenterPw, setReenterPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    window.testcard.sync.status().then(setStatus);
  }, []);

  async function handleSignIn(mode: "signIn" | "signUp"): Promise<void> {
    setBusy(true);
    setFormError(undefined);
    try {
      const result = mode === "signIn" ? await window.testcard.sync.signIn(email, password) : await window.testcard.sync.signUp(email, password);
      setStatus(result);
      setPassword("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    setStatus(await window.testcard.sync.signOut());
    setBusy(false);
  }

  async function handleSyncNow(): Promise<void> {
    setBusy(true);
    setStatus(await window.testcard.sync.triggerNow());
    setBusy(false);
  }

  async function handleReenter(): Promise<void> {
    setBusy(true);
    setFormError(undefined);
    try {
      setStatus(await window.testcard.sync.reenterPassword(reenterPw));
      setReenterPw("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not resume sync.");
    } finally {
      setBusy(false);
    }
  }

  if (status.account === "needs-password") {
    return (
      <main className="pw-account-view pw-main">
        <div className="pw-head">
          <h2>Account</h2>
        </div>
        <div className="pw-scroll">
          <p>Signed in as {status.email}. Re-enter your password to resume syncing on this device.</p>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={reenterPw}
              onChange={(e) => setReenterPw(e.target.value)}
              disabled={busy}
            />
          </label>
          {formError && <p className="msg msg--error">{formError}</p>}
          <button type="button" className="btn btn--primary" onClick={handleReenter} disabled={busy || reenterPw === ""}>
            Resume sync
          </button>
        </div>
      </main>
    );
  }

  if (status.account === "signed-in") {
    return (
      <main className="pw-account-view pw-main">
        <div className="pw-head">
          <h2>Account</h2>
        </div>
        <div className="pw-scroll">
          <p>Signed in as {status.email}</p>
          <p>
            {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : "Not yet synced"}
          </p>
          {status.lastError && <p className="msg msg--error">{status.lastError}</p>}
          <button type="button" className="btn btn--primary" onClick={handleSyncNow} disabled={busy}>
            Sync now
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleSignOut} disabled={busy}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="pw-account-view pw-main">
      <div className="pw-head">
        <h2>Account</h2>
      </div>
      <div className="pw-scroll">
        <p>Sign in to sync watch progress, favourites, and sources across your devices.</p>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </label>
        {formError && <p className="msg msg--error">{formError}</p>}
        <button type="button" className="btn btn--primary" onClick={() => handleSignIn("signIn")} disabled={busy || email === "" || password === ""}>
          Sign in
        </button>
        <button type="button" className="btn btn--primary" onClick={() => handleSignIn("signUp")} disabled={busy || email === "" || password === ""}>
          Create account
        </button>
      </div>
    </main>
  );
}
