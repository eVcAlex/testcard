import { useEffect } from "react";
import { CONTACT_EMAIL } from "../site.ts";

export function Privacy() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Privacy | Testcard";
    return () => { document.title = prev; };
  }, []);
  return (
    <article>
      <h1>Privacy</h1>
      <p className="draft">Draft: this page is a placeholder and will be replaced before public launch.</p>
      <h2>Data on your device</h2>
      <p>Testcard keeps your channels, films, series, guide and viewing history in a local SQLite database on your device.</p>
      <h2>Provider logins</h2>
      <p>Your provider logins are held in your device’s secure store (Windows DPAPI on Windows, the Android keystore on Fire TV), never in the database and never written to logs.</p>
      <h2>Account sync</h2>
      <p>If you sign in, your account stores your sources, favourites, recently watched, progress, profiles and hidden items so they stay in step across devices. Provider credentials are synced only encrypted with a key derived from your account password.</p>
      <h2>Update checks</h2>
      <p>The apps check for new versions by contacting our release server.</p>
      <h2>This website</h2>
      <p>This website sets no cookies and has no analytics.</p>
      <h2>Retention and legal basis</h2>
      <p>Not yet written: how long account data is kept, how to delete an account, and the legal basis for processing.</p>
      <h2>Contact</h2>
      <p>Privacy questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
    </article>
  );
}
