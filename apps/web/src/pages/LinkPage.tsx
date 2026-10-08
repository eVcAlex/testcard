import { useMutation } from "@tanstack/react-query";
import { formatLinkCode, normaliseLinkCode } from "@testcard/core/src/sync/linkCrypto.ts";
import { type FormEvent, useEffect, useState } from "react";
import { type Field, LinkError, type Mode, linkTv } from "../link/linkTv.ts";

const pretty = (typed: string) => formatLinkCode(normaliseLinkCode(typed).slice(0, 8));

function codeFromHash(): string {
  if (typeof location === "undefined") return "";
  const fromHash = normaliseLinkCode(location.hash.slice(1));
  if (fromHash === "") return "";
  history.replaceState(null, "", location.pathname);
  return pretty(fromHash);
}

export function LinkPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ message: string; field?: Field }>();

  const link = useMutation({
    mutationFn: linkTv,
    onError: (e) => {
      const failure = e instanceof LinkError ? e : new LinkError("Something went wrong. Try again.");
      setError({ message: failure.message, field: failure.field });
      if (failure.switchToSignin) setMode("signin");
    },
  });

  // Read after mount so the prerendered form and the first client render match.
  useEffect(() => {
    const fromHash = codeFromHash();
    if (fromHash !== "") setCode(fromHash);
  }, []);

  useEffect(() => {
    if (error?.field) document.getElementById(`link-${error.field}`)?.focus();
  }, [error]);

  if (link.isSuccess) {
    return (
      <section className="wrap page">
        <h1>You're signed in on your TV</h1>
        <p className="lead">Your TV is loading your sources now. You can close this page.</p>
      </section>
    );
  }

  const choose = (next: Mode) => { setMode(next); setError(undefined); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    link.mutate({ code, email, password, confirm, mode });
  };
  const invalid = (field: Field) => (error?.field === field ? true : undefined);
  const signup = mode === "signup";

  return (
    <section className="wrap page">
      <h1>Link your TV</h1>
      <p className="lead">Enter the code on your TV, then sign in or create your Testcard account. Your TV will sign in on its own.</p>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!signup} onClick={() => choose("signin")}>Sign in</button>
        <button type="button" role="tab" aria-selected={signup} onClick={() => choose("signup")}>Create account</button>
      </div>
      <form className="card" onSubmit={submit} noValidate autoComplete="on">
        <label>Code on your TV
          <input id="link-code" value={code} onChange={(e) => setCode(pretty(e.target.value))} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX" maxLength={9} aria-invalid={invalid("code")} />
        </label>
        <label>Email
          <input id="link-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" placeholder="you@example.com" aria-invalid={invalid("email")} />
        </label>
        <label>Password
          <input id="link-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "At least 8 characters" : "Your Testcard password"} aria-invalid={invalid("password")} />
        </label>
        {signup && (
          <label>Confirm password
            <input id="link-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Type it again" aria-invalid={invalid("confirm")} />
          </label>
        )}
        <div className="error" role="alert" aria-live="polite">{error?.message}</div>
        <button className="button" type="submit" disabled={link.isPending}>
          {link.isPending ? "Linking..." : signup ? "Create account and link TV" : "Link this TV"}
        </button>
      </form>
      <p className="note">Your password is checked by Testcard, then scrambled in this page before it is passed to your TV. Only your TV can unscramble that copy, and only for the next 10 minutes. Your sources are encrypted with your password, so keep it safe: it cannot be recovered.</p>
    </section>
  );
}
