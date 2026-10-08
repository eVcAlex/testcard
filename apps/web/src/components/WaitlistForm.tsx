import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { errorStatus, joinWaitlist } from "../api.ts";
import { CONTACT_EMAIL } from "../site.ts";

type Phase = "idle" | "sending" | "done" | "error";

export const WAITLIST_DONE = "You're on the list. We'll email you when the beta opens. That's the only email we'll send.";
export const WAITLIST_RATE_LIMITED = "Too many sign-ups from this network today. Try again tomorrow.";
export const WAITLIST_FAILED = `Something went wrong and you're not on the list yet. Try again, or email ${CONTACT_EMAIL} and we'll add you by hand.`;

/** Email plus optional device ticks. */
export function WaitlistForm() {
  const uid = useId();
  const [email, setEmail] = useState("");
  const [windows, setWindows] = useState(false);
  const [firetv, setFiretv] = useState(false);
  const [hpNote, setHpNote] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const message = useRef<HTMLParagraphElement>(null);

  // Move focus to the outcome so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (phase === "done" || phase === "error") message.current?.focus();
  }, [phase]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase === "sending") return;
    setPhase("sending");
    try {
      await joinWaitlist({ email: email.trim(), windows, firetv, hp_note: hpNote });
      setPhase("done");
    } catch (e) {
      setError(errorStatus(e) === 429 ? WAITLIST_RATE_LIMITED : WAITLIST_FAILED);
      setPhase("error");
    }
  }

  return (
    <div className="wl">
      {phase === "done" ? (
        <p ref={message} className="wl-msg" role="status" tabIndex={-1}>{WAITLIST_DONE}</p>
      ) : (
        <form method="post" action="/waitlist" onSubmit={submit} aria-busy={phase === "sending"}>
          <label className="wl-field" htmlFor={`${uid}-email`}>
            <span>Email address</span>
            <input id={`${uid}-email`} name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <fieldset className="wl-devices">
            <legend>Which devices will you use? (optional)</legend>
            <label className="wl-check">
              <input type="checkbox" name="windows" checked={windows} onChange={(e) => setWindows(e.target.checked)} />
              <span>Windows</span>
            </label>
            <label className="wl-check">
              <input type="checkbox" name="firetv" checked={firetv} onChange={(e) => setFiretv(e.target.checked)} />
              <span>Fire TV</span>
            </label>
          </fieldset>
          <div className="wl-hp" aria-hidden="true">
            <label htmlFor={`${uid}-hp`}>Leave this field empty</label>
            <input id={`${uid}-hp`} name="hp_note" type="text" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore value={hpNote} onChange={(e) => setHpNote(e.target.value)} />
          </div>
          <button type="submit" className="button" disabled={phase === "sending"}>
            {phase === "sending" ? "Joining..." : "Join the beta waitlist"}
          </button>
          {phase === "error" && <p ref={message} className="wl-msg wl-error" role="alert" tabIndex={-1}>{error}</p>}
          {phase === "sending" && <p className="sr-only" role="status">Joining the waitlist</p>}
        </form>
      )}
      <p className="wl-data note">
        We store your email, the devices you ticked and the time you signed up. We use them only to invite you to the beta. Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we'll delete them. More in the <Link to="/privacy">privacy policy</Link>.
      </p>
    </div>
  );
}
