import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, PRODUCT_NAME } from "../site.ts";
import "./content.css";

const Confirm = ({ children }: { children: string }) => (
  <p className="confirm"><b>Owner to confirm:</b> {children}</p>
);

const SECTIONS = [
  ["device", "Data on your device"],
  ["logins", "Provider logins"],
  ["sync", "Account sync"],
  ["updates", "Update checks"],
  ["website", "This website"],
  ["waitlist", "The beta waitlist"],
  ["retention", "Keeping and deleting your data"],
  ["contact", "Contact"],
] as const;

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export function Privacy() {
  return (
    <article className="wrap page prose has-toc">
      <h1>Privacy</h1>
      <p className="lead">What {PRODUCT_NAME} and this website store, what stays on your device, and how to have it deleted. Plain English, no tracking.</p>
      <nav className="toc" aria-label="On this page">
        <b>On this page</b>
        <ol>{SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
      </nav>
      <p className="note">Boxes marked "Owner to confirm" are facts or legal choices that have not been checked yet. They will be settled before the public launch.</p>

      <section id="device" aria-labelledby="device-h" className="block">
        <h2 id="device-h">Data on your device</h2>
        <p>{PRODUCT_NAME} keeps your channels, films, series, guide and viewing history in a local SQLite database on your device. That database is yours: it isn't uploaded unless you sign in and use sync (see below), and then only the parts listed there.</p>
      </section>

      <section id="logins" aria-labelledby="logins-h" className="block">
        <h2 id="logins-h">Provider logins</h2>
        <p>Your provider logins are held in your device's secure store (Windows DPAPI on Windows, the Android keystore on Fire TV). They are never kept in the database and never written to logs.</p>
      </section>

      <section id="sync" aria-labelledby="sync-h" className="block">
        <h2 id="sync-h">Account sync</h2>
        <p>If you sign in, your account stores your sources, favourites, recently watched, progress, profiles and hidden items so they stay in step across devices. You don't have to sign in to use the app on one device.</p>
        <p>Provider credentials are synced only encrypted, with a key derived from your account password. We hold the encrypted copy and not the key, so we can't read your provider logins. That is also why a forgotten password can't be recovered.</p>
        <p>To sign in a TV, you enter a code on <Link to="/link">evicted.dev/link</Link>. Your password is checked by the service, then scrambled in the page before it is passed to the TV. Only the TV can unscramble that copy, and only for 10 minutes.</p>
        <Confirm>what the account itself stores beyond the above (email address, sign-in records, any logs), where it is hosted, how long it is kept, and how an account is deleted.</Confirm>
      </section>

      <section id="updates" aria-labelledby="updates-h" className="block">
        <h2 id="updates-h">Update checks</h2>
        <p>The apps check for new versions by contacting our release server (evicted.dev). The request is a plain download of a small version file. The Fire TV app checks shortly after it starts and every six hours, and you can switch that off in its settings. The server answers requests like any web server, so it sees the address they came from.</p>
        <Confirm>whether the release server keeps access logs, and for how long.</Confirm>
      </section>

      <section id="website" aria-labelledby="website-h" className="block">
        <h2 id="website-h">This website</h2>
        <p>This website sets no cookies and has no analytics. It loads its own fonts and files from its own address only, with nothing from third parties.</p>
        <p>The light, dark or automatic theme button remembers your choice in your browser's local storage under the name <code>tc-theme</code>. It stays in your browser, is never sent to us, and the site works without it. Clear your site data to remove it.</p>
        <Confirm>whether the hosting provider keeps server logs (such as IP addresses) and for how long.</Confirm>
      </section>

      <section id="waitlist" aria-labelledby="waitlist-h" className="block">
        <h2 id="waitlist-h">The beta waitlist</h2>
        <p>When you join the waitlist we store three things: your email address, which devices you ticked (Windows, Fire TV, either or neither), and the time you signed up.</p>
        <ul>
          <li><b>Why:</b> only to email you an invitation when the beta opens. We don't use it for anything else, we don't send newsletters, and we don't share or sell it. There is no confirmation email.</li>
          <li><b>How long:</b> until the beta invitation has been sent, plus 30 days, or until you ask us to delete it, whichever comes first.</li>
          <li><b>Deleting it:</b> email <Mail /> from the address you signed up with, and we'll delete it.</li>
          <li><b>Abuse protection:</b> to limit sign-ups from one place, the service keeps a count per network address using a one-way hash that changes daily. The address itself isn't stored. The form also has a hidden field that only bots fill in.</li>
        </ul>
        <Confirm>that the 30-day retention above is the period you want, who processes the list (the host and any email service used to send invitations), and the legal basis for holding it.</Confirm>
      </section>

      <section id="retention" aria-labelledby="retention-h" className="block">
        <h2 id="retention-h">Keeping and deleting your data</h2>
        <p>Data on your device stays there until you remove the source or uninstall the app. For anything we hold about you, email <Mail /> and ask for it to be deleted.</p>
        <Confirm>retention periods for account data, the process for deleting an account, and the legal basis for processing (for example consent for the waitlist). This needs the owner's decision, so none is stated here.</Confirm>
      </section>

      <section id="contact" aria-labelledby="contact-h" className="block">
        <h2 id="contact-h">Contact</h2>
        <p>Privacy questions: <Mail />. Made by Evicted.</p>
      </section>
    </article>
  );
}
