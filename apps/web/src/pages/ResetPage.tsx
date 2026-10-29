import { type FormEvent, useEffect, useState } from "react";
import { BackChip, Disc } from "../ui/parts.tsx";

const MIN_PASSWORD = 8;

type Step = { kind: "ask" } | { kind: "asked" } | { kind: "choose"; token: string } | { kind: "expired" } | { kind: "done" };

/**
 * Forgotten password. Without a token this asks for the account's email and always answers the same, so it cannot be used
 * to find out who has an account. The emailed link comes back here with `?token=`, which is read once and taken out of the
 * address bar, then used to choose a new password. A reset clears the sources and profiles stored with the account (they
 * are sealed under the old password), and signs every device out; devices put them back when they sign in again.
 */
export function ResetPage() {
  const [step, setStep] = useState<Step>({ kind: "ask" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Read after mount so the prerendered page and the first client render match.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    if (token !== null || params.get("error") !== null) {
      history.replaceState(null, "", location.pathname);
      setStep(token !== null && token !== "" ? { kind: "choose", token } : { kind: "expired" });
    }
  }, []);

  const post = (path: string, body: unknown) =>
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email address you signed up with.");
    setBusy(true);
    try {
      const response = await post("/auth/request-password-reset", { email: email.trim(), redirectTo: `${location.origin}/reset` });
      if (response.status === 429) setError("Too many requests. Wait a while and try again.");
      else setStep({ kind: "asked" });
    } catch {
      setError("Couldn't reach Testcard. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (event: FormEvent, token: string) => {
    event.preventDefault();
    setError(undefined);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const response = await post("/auth/reset-password", { newPassword: password, token });
      if (response.ok) setStep({ kind: "done" });
      else if (response.status === 429) setError("Too many tries. Wait a while and try again.");
      else setStep({ kind: "expired" });
    } catch {
      setError("Couldn't reach Testcard. Check your connection and try again.");
    } finally {
      setBusy(false);
      setPassword("");
      setConfirm("");
    }
  };

  if (step.kind === "done") {
    return (
      <section className="page-in wrap">
        <BackChip />
        <div className="lform ok" role="status">
          <Disc />
          <h1 className="ok-h" tabIndex={-1}>Your password is changed</h1>
          <p>Sign in again on each device with the new password. Your favourites and watch history are still there.</p>
          <p>Sources and profiles are stored scrambled with your password, so they were cleared from our servers. Any device you were signed in on puts them back when you sign in again. If you have no such device, add your sources again.</p>
        </div>
      </section>
    );
  }

  if (step.kind === "asked") {
    return (
      <section className="page-in wrap">
        <BackChip />
        <div className="lform ok" role="status">
          <Disc />
          <h1 className="ok-h" tabIndex={-1}>Check your email</h1>
          <p>If that address has a Testcard account, we've sent it a link to choose a new password. It works for an hour. Nothing arriving? Look in your spam folder.</p>
        </div>
      </section>
    );
  }

  if (step.kind === "expired") {
    return (
      <section className="page-in wrap">
        <BackChip />
        <div className="lform ok" role="status">
          <h1 className="ok-h" tabIndex={-1}>That link has expired</h1>
          <p>Reset links work once, for an hour. <a href="/reset" onClick={(e) => { e.preventDefault(); setStep({ kind: "ask" }); }}>Ask for a new one</a>.</p>
        </div>
      </section>
    );
  }

  const choosing = step.kind === "choose";
  return (
    <section className="page-in wrap">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>{choosing ? "Choose a new password" : "Forgot your password?"}</h1>
      <p className="case-lede" data-rise>
        {choosing
          ? "Pick something you will remember. Your sources are scrambled with your password, so they are cleared when you change it and put back from your devices."
          : "Enter the email address you signed up with and we'll send you a link."}
      </p>
      <div className="lform" data-rise>
        <form className="lform-in" onSubmit={(event) => (choosing ? choose(event, step.token) : ask(event))} noValidate>
          {choosing ? (
            <>
              <div className="fld">
                <label htmlFor="reset-password">New password</label>
                <input id="reset-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
              </div>
              <div className="fld">
                <label htmlFor="reset-confirm">Confirm password</label>
                <input id="reset-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Type it again" />
              </div>
            </>
          ) : (
            <div className="fld">
              <label htmlFor="reset-email">Email</label>
              <input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" placeholder="you@example.com" />
            </div>
          )}
          <div className="error" role="alert">{error}</div>
          <button className="btn wide" type="submit" disabled={busy}>
            {busy ? "Please wait..." : choosing ? "Change password" : "Send me a link"}
          </button>
        </form>
      </div>
    </section>
  );
}
