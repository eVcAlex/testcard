import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, ORG_NAME, PRODUCT_FULL_NAME } from "../site.ts";
import { ColourBars } from "./ColourBars.tsx";

export function Footer() {
  return (
    <footer className="foot">
      <ColourBars />
      <div className="wrap foot-inner">
        <p className="foot-line">
          <span className="foot-name">{PRODUCT_FULL_NAME}</span>
          <span className="foot-sub">
            <span>made by {ORG_NAME}</span>
            <span aria-hidden="true"> · </span>
            <span>Ships no channels.</span>
          </span>
        </p>
        <nav className="foot-nav" aria-label="Footer">
          <Link to="/setup">Setup</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/download">Beta</Link>
          <Link to="/link">Link TV</Link>
          <Link to="/privacy">Privacy</Link>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </nav>
        <p className="foot-credit">
          Inter typeface by Rasmus Andersson, <a href="/fonts/OFL.txt">SIL Open Font License</a>.
        </p>
      </div>
    </footer>
  );
}
