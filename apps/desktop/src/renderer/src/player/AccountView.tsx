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

  if (status.account === "signed-in") {
    return (
      <div className="account-view">
        <h2>Account</h2>
        <p>Signed in as {status.email}</p>
        <p>
          {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : "Not yet synced"}
        </p>
        {status.lastError && <p className="account-view__error">{status.lastError}</p>}
        <button type="button" onClick={handleSyncNow} disabled={busy}>
          Sync now
        </button>
        <button type="button" onClick={handleSignOut} disabled={busy}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="account-view">
      <h2>Account</h2>
      <p>Sign in to sync watch progress, favourites, and sources across your devices.</p>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
      {formError && <p className="account-view__error">{formError}</p>}
      <button type="button" onClick={() => handleSignIn("signIn")} disabled={busy || email === "" || password === ""}>
        Sign in
      </button>
      <button type="button" onClick={() => handleSignIn("signUp")} disabled={busy || email === "" || password === ""}>
        Create account
      </button>
    </div>
  );
}
