import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PRODUCT_NAME, WAITLIST_HREF } from "../site.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

const WAITLIST = WAITLIST_HREF.split("#") as [string, string];

function NavLinks() {
  return (
    <>
      <Link to="/" hash="guide" activeOptions={{ includeHash: true }}>Guide</Link>
      <Link to="/setup">Setup</Link>
      <Link to="/faq">FAQ</Link>
      <Link to="/download">Download</Link>
    </>
  );
}

const JoinLink = ({ className }: { className?: string }) => (
  <Link to={WAITLIST[0]} hash={WAITLIST[1]} className={`button${className ? ` ${className}` : ""}`}>Join the beta</Link>
);

export function Header() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const show = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    setOpen(true);
  };
  const hide = () => {
    const d = dialog.current;
    if (!d?.open) return;
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
    setOpen(false);
  };

  // The sheet is for narrow screens only: close it if the window grows past the breakpoint.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 48em)");
    const onChange = () => { if (wide.matches) hide(); };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <header className="bar">
      <div className="wrap bar-inner">
        <Link to="/" className="brand" aria-label={`${PRODUCT_NAME} home`}>test<b>card</b></Link>
        <nav className="nav-main" aria-label="Main">
          <NavLinks />
        </nav>
        <div className="bar-actions">
          <Link to="/link" className="nav-link-tv">Link TV</Link>
          <ThemeToggle />
          <span className="join-desktop"><JoinLink /></span>
          <button type="button" className="icon-btn menu-btn" aria-haspopup="dialog" aria-expanded={open} onClick={show}>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
            <span className="sr-only">Menu</span>
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="menu"
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).closest("a")) hide(); }}
      >
        <div className="menu-head">
          <span className="brand" aria-hidden="true">test<b>card</b></span>
          <button type="button" className="icon-btn" onClick={hide} autoFocus>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l11 11M15.5 4.5l-11 11" /></svg>
            <span className="sr-only">Close menu</span>
          </button>
        </div>
        <nav className="menu-nav" aria-label="Menu">
          <NavLinks />
          <Link to="/link">Link TV</Link>
          <JoinLink className="menu-join" />
        </nav>
      </dialog>
    </header>
  );
}
