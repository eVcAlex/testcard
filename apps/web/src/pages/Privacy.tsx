import { Link } from "@tanstack/react-router";
import { BackChip } from "../ui/parts.tsx";
import { CONTACT_EMAIL, PRODUCT_NAME } from "../site.ts";

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
    <article className="page-in wrap prose has-toc">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>Privacy</h1>
      <p className="case-lede" data-rise>What {PRODUCT_NAME} and this website store, what stays on your device, and how to have it deleted. Plain English, no tracking.</p>
      <nav className="toc" aria-label="On this page">
        <b>On this page</b>
        <ol>{SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
      </nav>

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
        <p>The account itself stores your email address, a hash of your password (never the password), the name you gave it if any, and a record of each sign-in: when it happened, the network address and the browser or app it came from. Sign-in records expire on their own. It is all held on Cloudflare (Workers, D1 database and R2 storage), which hosts this service.</p>
      </section>

      <section id="updates" aria-labelledby="updates-h" className="block">
        <h2 id="updates-h">Update checks</h2>
        <p>The apps check for new versions by contacting our release server (evicted.dev). The request is a plain download of a small version file. The Fire TV app checks shortly after it starts and every six hours, and you can switch that off in its settings. The server answers requests like any web server, so it sees the address they came from. We don't keep our own access logs of these requests. Cloudflare, which serves them, processes request details such as the address to deliver and protect the service, under its own privacy policy.</p>
      </section>

      <section id="website" aria-labelledby="website-h" className="block">
        <h2 id="website-h">This website</h2>
        <p>This website sets no cookies and has no analytics. It loads its own fonts and files from its own address only, with nothing from third parties.</p>
        <p>The light, dark or automatic theme button remembers your choice in your browser's local storage under the name <code>tc-theme</code>. It stays in your browser, is never sent to us, and the site works without it. Clear your site data to remove it. The opening animation notes that it has played in your tab's session storage under <code>tc-intro</code>, so it only runs once per visit; that is gone when you close the tab.</p>
        <p>The site is served by Cloudflare. As with the update checks, we keep no logs of our own, and Cloudflare handles request details under its own privacy policy.</p>
      </section>

      <section id="waitlist" aria-labelledby="waitlist-h" className="block">
        <h2 id="waitlist-h">The beta waitlist</h2>
        <p>When you join the waitlist we store three things: your email address, which devices you ticked (Windows, Fire TV, either or neither), and the time you signed up.</p>
        <ul>
          <li><b>Why:</b> only to email you an invitation when the beta opens. We don't use it for anything else, we don't send newsletters, and we don't share or sell it. There is no confirmation email.</li>
          <li><b>How long:</b> until we have sent your invitation, or until you ask us to delete it, whichever comes first. We don't keep the list after the beta opens to everyone.</li>
          <li><b>Deleting it:</b> email <Mail /> from the address you signed up with, and we'll delete it.</li>
          <li><b>Abuse protection:</b> to limit sign-ups from one place, the service keeps a count per network address using a one-way hash that changes daily. The address itself isn't stored. The form also has a hidden field that only bots fill in.</li>
        </ul>
        <p>The list is held in our database on Cloudflare. We will email the invitations ourselves and won't pass the list to anyone else. We hold it because you asked to be invited, which is your consent, and you can withdraw it at any time by emailing us.</p>
      </section>

      <section id="retention" aria-labelledby="retention-h" className="block">
        <h2 id="retention-h">Keeping and deleting your data</h2>
        <p>Data on your device stays there until you remove the source or uninstall the app. For anything we hold about you, email <Mail /> from the address on your account or waitlist entry and ask for it to be deleted. We delete the account, its synced data and its sign-in records, and tell you when it is done. Account data is otherwise kept for as long as the account exists.</p>
      </section>

      <section id="contact" aria-labelledby="contact-h" className="block">
        <h2 id="contact-h">Contact</h2>
        <p>Privacy questions: <Mail />. Made by Evicted.</p>
      </section>
    </article>
  );
}
