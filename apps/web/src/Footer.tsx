import { CONTACT_EMAIL } from "./site.ts";

// Plain anchors, not router Links, so the footer renders without a router (same as the Download page's /link).
export function Footer() {
  return (
    <footer className="foot">
      <span>Testcard is made by Evicted.</span>
      <a href="/privacy">Privacy</a>
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      <span className="note">Testcard brings no channels: you add your own sources.</span>
      <span className="credit">
        Inter typeface by Rasmus Andersson, <a href="/fonts/OFL.txt">SIL Open Font License</a>.
      </span>
    </footer>
  );
}
