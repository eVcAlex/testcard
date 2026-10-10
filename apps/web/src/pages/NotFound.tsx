import { Link } from "@tanstack/react-router";
import { Bars } from "../ui/parts.tsx";

export function NotFound() {
  return (
    <section className="lost wrap">
      <div className="lost-sq" aria-hidden="true"><Bars /><span>No signal</span></div>
      <h1 className="giant" tabIndex={-1}>No signal</h1>
      <p className="case-lede">That page isn't here. It may have moved, or the address is wrong.</p>
      <div className="btns">
        <Link to="/" className="btn fill">Back to the home page</Link>
        <Link to="/features" className="btn line">See what it does</Link>
      </div>
    </section>
  );
}
