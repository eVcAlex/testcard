import { useMutation } from "@tanstack/react-query";
import { formatLinkCode, normaliseLinkCode } from "@testcard/core/src/sync/linkCrypto.ts";
import { type FormEvent, useEffect, useState } from "react";
import { BackChip, Disc, Meta } from "../ui/parts.tsx";
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
      <section className="page-in wrap" key="done">
        <BackChip />
        <div className="lform ok" role="status">
          <Disc />
          <h1 className="ok-h" tabIndex={-1}>You're signed in on your TV</h1>
          <p>Your TV is loading your sources now. You can close this page.</p>
        </div>
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
  const describedBy = (field: Field) => (error?.field === field ? "link-error" : undefined);
  const signup = mode === "signup";

  return (
    <section className="page-in wrap">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>Link your TV</h1>
      <p className="case-lede" data-rise>Enter the code on your TV, then sign in or create your Testcard account. Your TV will sign in on its own.</p>
      <Meta items={[["You need", "Your TV and your account"], ["Also at", "evicted.dev/link"], ["Takes", "About a minute"]]} />
      <div className="linkg">
        <ol className="lsteps" data-rise>
          <li><p className="tracked">Step 01</p><p>On the TV, open Testcard and choose <b>Sign in</b>.</p></li>
          <li>
            <p className="tracked">Step 02</p>
            <p>The TV shows a code, like this example:</p>
            <div className="tvcode" role="img" aria-label="Example code: K7Q4-MD2X"><p className="br" aria-hidden="true">[ Example only ]</p><p aria-hidden="true">K7Q4-MD2X</p></div>
          </li>
          <li><p className="tracked">Step 03</p><p>Type it here with your account details. That's it.</p></li>
        </ol>
        <div className="link-r" data-rise>
          <div className="lform">
            <div className="mode" role="tablist">
              <button type="button" role="tab" aria-selected={!signup} onClick={() => choose("signin")}>Sign in</button>
              <button type="button" role="tab" aria-selected={signup} onClick={() => choose("signup")}>Create account</button>
            </div>
            <form className="lform-in" onSubmit={submit} noValidate autoComplete="on">
              <div className="fld">
                <label htmlFor="link-code">Code on your TV</label>
                <input id="link-code" className="codein" value={code} onChange={(e) => setCode(pretty(e.target.value))} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX" maxLength={9} aria-invalid={invalid("code")} aria-describedby={describedBy("code")} />
              </div>
              <div className="fld">
                <label htmlFor="link-email">Email</label>
                <input id="link-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" placeholder="you@example.com" aria-invalid={invalid("email")} aria-describedby={describedBy("email")} />
              </div>
              <div className="fld">
                <label htmlFor="link-password">Password</label>
                <input id="link-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "At least 8 characters" : "Your Testcard password"} aria-invalid={invalid("password")} aria-describedby={describedBy("password")} />
              </div>
              {signup && (
                <div className="fld">
                  <label htmlFor="link-confirm">Confirm password</label>
                  <input id="link-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Type it again" aria-invalid={invalid("confirm")} aria-describedby={describedBy("confirm")} />
                </div>
              )}
              <div id="link-error" className="error" role="alert">{error?.message}</div>
              <button className="btn wide" type="submit" disabled={link.isPending}>
                {link.isPending ? "Linking..." : signup ? "Create account and link TV" : "Link this TV"}
              </button>
            </form>
          </div>
          <p className="note link-note">Your password is checked by Testcard, then scrambled in this page before it is passed to your TV. Only your TV can unscramble that copy, and only for the next 10 minutes. Your sources are encrypted with your password, so keep it safe: it cannot be recovered.</p>
        </div>
      </div>
    </section>
  );
}
