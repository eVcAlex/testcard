import { Link } from "@tanstack/react-router";
import { PRODUCT_NAME } from "../site.ts";
import "./content.css";

const SECTIONS = [
  ["need", "What you need"],
  ["add", "Add a source"],
  ["load", "Choose what to load"],
  ["guide", "The TV guide (XMLTV)"],
  ["refresh", "Refresh"],
  ["names", "Tidy names"],
  ["link-tv", "Sign in a TV with a code"],
  ["profiles", "Profiles"],
] as const;

export function Setup() {
  return (
    <article className="wrap page prose has-toc">
      <h1>Add your first source</h1>
      <p className="lead">{PRODUCT_NAME} plays what you give it. This is how to give it an Xtream Codes login or an M3U playlist, load a TV guide, and sign in your TV.</p>
      <nav className="toc" aria-label="On this page">
        <b>On this page</b>
        <ol>{SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
      </nav>

      <section id="need" aria-labelledby="need-h" className="block">
        <h2 id="need-h">What you need</h2>
        <p>A source you are entitled to use: an Xtream Codes login, or an M3U playlist address, from a provider you have the right to watch. {PRODUCT_NAME} ships no channels, playlists or streams and doesn't recommend providers, so this part is yours to bring.</p>
        <p>On Windows you add and edit sources in the <b>Sources</b> screen. You can also add and edit them on the Fire TV app.</p>
      </section>

      <section id="add" aria-labelledby="add-h" className="block">
        <h2 id="add-h">Add a source</h2>
        <p>On the Sources screen, start a new source and pick the type at the top of the form: <b>Xtream Codes</b> or <b>M3U playlist</b>. Give the source a <b>Name</b>, whatever helps you tell your sources apart.</p>
        <h3 id="xtream">Xtream Codes</h3>
        <ul>
          <li><b>Server URL</b>: the portal address from your provider, for example <code>http://line.example.com:8080</code>, without <code>/get.php</code>.</li>
          <li><b>Username</b> and <b>Password</b>: the login from your provider.</li>
          <li><b>Backup server URLs</b> (optional): other addresses for the same login, separated by commas. {PRODUCT_NAME} uses one when the main server can't be reached.</li>
        </ul>
        <p>If your provider gave you an Xtream <code>get.php</code> link instead, paste it into the playlist field below. {PRODUCT_NAME} works out which kind it is.</p>
        <h3 id="m3u">M3U playlist</h3>
        <ul>
          <li><b>Playlist URL</b>: the address of an M3U or M3U8 playlist. The form takes an address, not a file.</li>
          <li>Add an XMLTV address if you want a guide and the playlist doesn't name one (next section).</li>
        </ul>
        <p>Your logins are kept in your device's secure store, not in the library database and never in logs.</p>
      </section>

      <section id="load" aria-labelledby="load-h" className="block">
        <h2 id="load-h">Choose what to load</h2>
        <p>Under <b>Content</b>, switch on what to load from this provider: <b>Live TV</b>, <b>Movies</b> and <b>Series</b>. At least one must be on. You can change this later.</p>
      </section>

      <section id="guide" aria-labelledby="guide-h" className="block">
        <h2 id="guide-h">The TV guide (XMLTV)</h2>
        <p>The guide comes from an XMLTV address. Under <b>Guide and updates</b>, the <b>XMLTV / EPG URL</b> field is optional. Leave it blank and {PRODUCT_NAME} looks for one when it refreshes: for Xtream sources the provider's <code>xmltv.php</code>, and for M3U playlists the <code>url-tvg</code> address in the playlist's header.</p>
        <p>Paste an address of your own if your provider gives you a guide separately, or if the playlist names none. The guide is read in the background after the channels load, so channels appear first. If a guide is empty or wrong, see <Link to="/faq" hash="guide">why a guide is empty or wrong</Link>.</p>
      </section>

      <section id="refresh" aria-labelledby="refresh-h" className="block">
        <h2 id="refresh-h">Refresh</h2>
        <p>Refreshing re-fetches the source's channels, films and series, then its guide. It is manual by default (<b>Off (manual only)</b>). On Windows, set <b>Auto-refresh</b> to every hour, 3, 6, 12 or 24 hours and {PRODUCT_NAME} does it in the background while it is open. On Fire TV, refresh a source by hand from Settings.</p>
        <p>A refresh merges into what you have rather than starting over, so your favourites and recently watched survive it, even when a provider renumbers or renames channels.</p>
      </section>

      <section id="names" aria-labelledby="names-h" className="block">
        <h2 id="names-h">Tidy names</h2>
        <p>Providers name channels in their own house styles, with country prefixes, borders, fancy lettering and quality tags. {PRODUCT_NAME} tidies the names it shows and searches, whatever the style, so <span className="raw">UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ</span> reads as <b>BBC One HD</b>. The provider's own name is kept alongside, and nothing is renamed at the provider.</p>
      </section>

      <section id="link-tv" aria-labelledby="link-tv-h" className="block">
        <h2 id="link-tv-h">Sign in a TV with a code</h2>
        <p>Typing a password with a remote is slow, so the TV shows a code instead.</p>
        <ol>
          <li>In the Fire TV app, choose Sign in. It shows a code.</li>
          <li>On a phone or computer, open <Link to="/link">evicted.dev/link</Link> and enter the code.</li>
          <li>Sign in, or create your {PRODUCT_NAME} account. Your TV signs in on its own, and your sources, favourites and progress arrive.</li>
        </ol>
        <p>Your sources are encrypted with your password, so keep it safe: it can't be recovered.</p>
      </section>

      <section id="profiles" aria-labelledby="profiles-h" className="block">
        <h2 id="profiles-h">Profiles</h2>
        <p>An account can have up to 4 profiles. Each has its own Continue watching, favourites, recently watched and progress, and they follow you to every device you sign in on.</p>
      </section>

      <p className="note">Not in the beta yet? <Link to="/download" hash="waitlist">Join the waitlist</Link>.</p>
    </article>
  );
}
