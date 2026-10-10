import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** A TV with nothing plugged in: colour bars, snow and scanlines behind an on-screen display. All CSS, and it holds still for reduced motion. */
export function NotFound() {
  // Read after mount: the prerendered 404.html is served at whatever address was asked for, so the server can't know it.
  const [path, setPath] = useState("");
  useEffect(() => setPath(location.pathname), []);
  return (
    <section className="lost">
      <div className="lost-screen" aria-hidden="true">
        <div className="lost-bars" />
        <div className="lost-snow" />
        <div className="lost-scan" />
        <div className="lost-roll" />
      </div>
      <div className="lost-osd">
        <p className="lost-ch" aria-hidden="true">CH 404</p>
        <h1 className="lost-h" data-text="No signal" tabIndex={-1}>No signal</h1>
        <p className="lost-p">That page isn't here. It may have moved, or the address is wrong.</p>
        {path && path !== "/" && <p className="lost-path"><span className="sr-only">You asked for </span>{path}</p>}
        <div className="btns">
          <Link to="/" className="btn fill">Back to the home page</Link>
        </div>
      </div>
    </section>
  );
}
