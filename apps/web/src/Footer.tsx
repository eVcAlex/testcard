import { CONTACT_EMAIL } from "./site.ts";

export function Footer() {
  return (
    <footer className="foot">
      <span>Testcard</span>
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      <span className="note">Testcard brings no channels: you add your own sources.</span>
    </footer>
  );
}
