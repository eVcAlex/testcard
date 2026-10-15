import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, MANAGE_HREF, ORG_NAME, PRODUCT_FULL_NAME, RELEASE_STATE, WATCH_HREF, WEB_PLAYER_LIVE } from "../site.ts";
import { Mark } from "../ui/parts.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { WaitlistLink } from "./WaitlistLink.tsx";

const SITE = [
  ["/", "Home"],
  ["/features", "Features"],
  ["/setup", "Setup"],
  ["/faq", "FAQ"],
  ["/download", RELEASE_STATE === "waitlist" ? "Beta" : "Download"],
  ["/changelog", "What's new"],
  ["/link", "Link your TV"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
] as const;

export function Footer() {
  return (
    <footer className="ftr wrap">
      <div className="ftr-top">
        <Link to="/" className="ftr-wm" aria-label={`${PRODUCT_FULL_NAME}, home`}><Mark big /></Link>
        <div className="ftr-ready">
          <p className="ready">Ready to watch?</p>
          <a className="ftr-mail" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          {RELEASE_STATE === "waitlist" && <WaitlistLink className="btn fill">Join the beta waitlist</WaitlistLink>}
        </div>
      </div>
      <div className="ftr-mid">
        <nav aria-label="Footer">
          <p className="ftr-k">Site</p>
          <ul>
            {SITE.map(([to, label]) => <li key={to}><Link to={to} className="ftr-a">{label}</Link></li>)}
            {/* A separate page, so a plain anchor: a router link would land on this site's 404. */}
            {WEB_PLAYER_LIVE && <li><a href={WATCH_HREF} className="ftr-a">Watch in your browser</a></li>}
            <li><a href={MANAGE_HREF} className="ftr-a">Manage sources and profiles</a></li>
          </ul>
        </nav>
      </div>
      <div className="ftr-bot">
        <p className="ftr-line">
          <span>{PRODUCT_FULL_NAME}, made by {ORG_NAME}.</span> <span>Ships no channels.</span>
        </p>
        <ThemeToggle />
      </div>
      <p className="ftr-credit">
        Screenshots show open movies by the Blender Foundation (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC BY</a>) and public-domain films; posters via Wikimedia Commons.
        Plus Jakarta Sans by the Plus Jakarta Sans Project Authors, <a href="/fonts/OFL-PlusJakartaSans.txt">SIL Open Font License</a>.
      </p>
    </footer>
  );
}
