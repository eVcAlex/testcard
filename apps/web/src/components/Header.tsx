import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CONTACT_EMAIL, PRODUCT_NAME, RELEASE_STATE } from "../site.ts";
import { Magnet } from "../ui/Magnet.tsx";
import { Disc, Mark } from "../ui/parts.tsx";
import { WaitlistLink } from "./WaitlistLink.tsx";

/** Wordmark top left and the contact address top right. They scroll away with the page; the pill below is the navigation. */
export function TopBar() {
  return (
    <header className="topbar wrap">
      <Link to="/" className="brand" aria-label={`${PRODUCT_NAME} home`}><Mark /></Link>
      <a className="mail" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </header>
  );
}

const LINKS = [
  { to: "/", label: "Home", exact: true },
  { to: "/features", label: "Features" },
  { to: "/setup", label: "Setup" },
  { to: "/faq", label: "FAQ" },
  { to: "/link", label: "Link your TV" },
] as const;

/** The one navigation: a pill fixed to the bottom of the screen. On a phone it folds to a Menu button and the main action. */
export function Header() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const path = useRouterState({ select: (s) => s.location.pathname });

  // A page change closes the menu (the link click itself may be intercepted by the page-change animation).
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>(".pill-links a")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", key);
    addEventListener("pointerdown", away);
    return () => { removeEventListener("keydown", key); removeEventListener("pointerdown", away); };
  }, [open]);

  return (
    <nav className="pill" aria-label="Main" ref={box}>
      <button type="button" className="pill-menu" ref={button} aria-expanded={open} aria-controls="pill-links" onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}
      </button>
      <ul className={`pill-links${open ? " open" : ""}`} id="pill-links" onClick={() => setOpen(false)}>
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} activeOptions={{ exact: "exact" in l }}>{l.label}</Link>
          </li>
        ))}
      </ul>
      <Magnet className="pill-mag">
        {RELEASE_STATE === "waitlist" ? (
          <WaitlistLink className="pill-cta"><Disc />Join the beta</WaitlistLink>
        ) : (
          <Link to="/download" className="pill-cta"><Disc />Download</Link>
        )}
      </Magnet>
    </nav>
  );
}
