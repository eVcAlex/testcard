import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, ORG_NAME, PRODUCT_FULL_NAME } from "../site.ts";
import { ColourBars } from "./ColourBars.tsx";

export function Footer() {
  return (
    <footer className="foot">
      <ColourBars />
      <div className="wrap foot-inner">
        <p className="foot-line">
          <span>{PRODUCT_FULL_NAME}</span>
          <span aria-hidden="true"> · </span>
          <span>made by {ORG_NAME}</span>
          <span aria-hidden="true"> · </span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden="true"> · </span>
          <span>Ships no channels.</span>
        </p>
        <p className="foot-credit">
          Inter typeface by Rasmus Andersson, <a href="/fonts/OFL.txt">SIL Open Font License</a>.
        </p>
      </div>
    </footer>
  );
}
