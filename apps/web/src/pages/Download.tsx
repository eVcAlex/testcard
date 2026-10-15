import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import wretch from "wretch";
import { WaitlistForm } from "../components/WaitlistForm.tsx";
import { BackChip, Meta } from "../ui/parts.tsx";
import { parseAndroid, parseDesktop } from "../releases.ts";
import { DOWNLOADER_CODE, PRODUCT_NAME, RELEASE_STATE, type ReleaseState, SIGNED, WATCH_HREF, WEB_PLAYER_LIVE } from "../site.ts";

// null, not undefined: TanStack Query v5 treats undefined data as an error (and retries).
const desktop = () => wretch("/app/latest.yml").get().text().then((t) => parseDesktop(t) ?? null).catch(() => null);
const android = () => wretch("/app/latest.json").get().json().then((j) => parseAndroid(j) ?? null).catch(() => null);

const TBC = <span className="tbc">not yet tested</span>;

function Requirements() {
  return (
    <table className="spec">
      <caption className="sr-only">Requirements by platform</caption>
      <thead>
        <tr><th scope="col">Platform</th><th scope="col">Requirement</th><th scope="col">How you install it</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Windows</th><td>Windows 10 or 11, 64-bit (x64) only</td><td>.exe installer</td></tr>
        <tr><th scope="row">Android TV and Fire TV</th><td>Android 7 or later, or Fire OS 6 or later {TBC}</td><td>.apk, installed with Downloader</td></tr>
        {WEB_PLAYER_LIVE ? (
          <tr><th scope="row">Phones, tablets and any computer</th><td>A current browser</td><td>Nothing to install: <a href={WATCH_HREF}>open the web player</a></td></tr>
        ) : (
          <tr><th scope="row">Phones and tablets</th><td>Not supported for now</td><td>None</td></tr>
        )}
      </tbody>
    </table>
  );
}

/** The SmartScreen note. Copy flips with SIGNED in site.ts. */
function WindowsNote({ signed = SIGNED }: { signed?: boolean }) {
  return signed ? (
    <p>The Windows installer is code-signed. We still publish a SHA-256 next to every build so you can check the file you downloaded.</p>
  ) : (
    <p>
      The Windows installer is not code-signed yet, so the first time you run it Windows SmartScreen will warn that it protected your PC. Choose <b>More info</b>, then <b>Run anyway</b>. We publish a SHA-256 next to every build so you can check the file first.
    </p>
  );
}

function FireTvNote() {
  return (
    <>
      <p>On an Android TV or Fire TV you install the app with the free Downloader app. Downloader code: <b className="dcode">{DOWNLOADER_CODE}</b>.</p>
      <ol>
        <li>Install <b>Downloader</b> from the Amazon Appstore (Fire TV) or Google Play (Android TV).</li>
        <li>Allow it to install apps. On Fire TV: Settings, My Fire TV, Developer options, <b>Install unknown apps</b>, switch Downloader on. On Android TV you are asked the first time. The menu names vary a little between versions.</li>
        <li>Open Downloader, type the code into its address box, choose <b>Go</b>, then <b>Install</b>.</li>
        <li>Open {PRODUCT_NAME}, choose Sign in, and enter the code it shows on <Link to="/link">evicted.dev/link</Link>.</li>
      </ol>
    </>
  );
}

const NoChannels = () => <p className="note">{PRODUCT_NAME} is a player only. It ships no channels, playlists or streams, and does not recommend providers. You add a source you are entitled to use.</p>;

/** Waitlist state: no download exists yet, so this page is the sign-up. */
function ComingSoon({ signed }: { signed: boolean }) {
  return (
    <article className="page-in wrap prose dl">
      <BackChip />
      <div className="dl-head">
        <h1 className="case-title split" tabIndex={-1}>{`Join the ${PRODUCT_NAME} beta`}</h1>
        <p className="case-lede" data-rise>{PRODUCT_NAME} is in private beta. The Windows app can't be downloaded yet: join the waitlist and we'll email you when it opens. On Android TV or Fire TV you can install the beta now with the Downloader code below.</p>
      </div>
      <Meta items={[["Works on", WEB_PLAYER_LIVE ? "Windows · Android TV · Browser" : "Windows · Android TV"], ["The beta", "Free"], ["You bring", "Your own source"], ["Updates", "Automatic"]]} />
      <div className="dl-grid">
        <section id="waitlist" aria-labelledby="waitlist-h" className="dl-form lform" data-rise>
          <h2 id="waitlist-h">Join the waitlist</h2>
          <WaitlistForm />
        </section>
        <div className="dl-info">
          <section id="beta" aria-labelledby="beta-h" className="block">
            <h2 id="beta-h">What the beta is</h2>
            <p>The beta is free. It covers the Windows app and the Android TV and Fire TV app. When the Windows beta opens we'll email an invitation to everyone on the list, in batches, and testers download the installer from this site. The TV app can be installed now with Downloader, using the code in the Android TV and Fire TV section below.</p>
          </section>
          <section id="requirements" aria-labelledby="requirements-h" className="block">
            <h2 id="requirements-h">Requirements</h2>
            <Requirements />
            <p className="note">The Android version is not yet tested on real hardware. We'll update it once it has been.</p>
          </section>
          <section id="windows" aria-labelledby="windows-h" className="block">
            <h2 id="windows-h">Windows</h2>
            <WindowsNote signed={signed} />
          </section>
          <section id="fire-tv" aria-labelledby="fire-tv-h" className="block">
            <h2 id="fire-tv-h">Android TV and Fire TV</h2>
            <FireTvNote />
          </section>
          <section id="no-channels" aria-labelledby="no-channels-h" className="block">
            <h2 id="no-channels-h">No channels shipped</h2>
            <p>{PRODUCT_NAME} ships no channels. It doesn't include a playlist, a provider or a subscription, and we can't supply one. You bring a source you are entitled to use. See <Link to="/setup">how to add one</Link>.</p>
          </section>
        </div>
      </div>
    </article>
  );
}

export function Download({ state = RELEASE_STATE, signed = SIGNED }: { state?: ReleaseState; signed?: boolean }) {
  return state === "waitlist" ? <ComingSoon signed={signed} /> : <Releases signed={signed} />;
}

function Sha({ value }: { value?: string }) {
  return value ? <p className="note">SHA-256: <code className="sha">{value}</code></p> : <p className="note">SHA-256: published next to the file.</p>;
}

function Releases({ signed }: { signed: boolean }) {
  const win = useQuery({ queryKey: ["desktop"], queryFn: desktop });
  const tv = useQuery({ queryKey: ["firetv"], queryFn: android });
  return (
    <article className="page-in wrap prose dl">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>Download {PRODUCT_NAME}</h1>
      <div className="card">
        <h2>Windows</h2>
        {win.data ? (
          <>
            <a className="button" href={`/app/${win.data.file}`}>Download for Windows {win.data.version}</a>
            <p className="note">Version {win.data.version}, file <code>{win.data.file}</code></p>
            <Sha value={win.data.sha256} />
          </>
        ) : (
          <p className="note">{win.isPending ? "Checking..." : "Not available right now."}</p>
        )}
        <WindowsNote signed={signed} />
      </div>
      <div className="card">
        <h2>Android TV and Fire TV</h2>
        {tv.data ? (
          <>
            <a className="button" href={`/app/${tv.data.file}`}>Download for Android TV</a>
            <p className="note">File <code>{tv.data.file}</code></p>
            <Sha value={tv.data.sha256} />
          </>
        ) : (
          <p className="note">{tv.isPending ? "Checking..." : "Not available right now."}</p>
        )}
        <FireTvNote />
      </div>
      <section aria-labelledby="requirements-h" className="block">
        <h2 id="requirements-h">Requirements</h2>
        <Requirements />
      </section>
      <NoChannels />
    </article>
  );
}
