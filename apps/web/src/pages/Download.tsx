import { useQuery } from "@tanstack/react-query";
import wretch from "wretch";
import { WaitlistForm } from "../components/WaitlistForm.tsx";
import { parseAndroid, parseDesktop } from "../releases.ts";
import { PRODUCT_NAME, RELEASE_STATE, type ReleaseState, SIGNED } from "../site.ts";
import "./content.css";

// null, not undefined: TanStack Query v5 treats undefined data as an error (and retries).
const desktop = () => wretch("/app/latest.yml").get().text().then((t) => parseDesktop(t) ?? null).catch(() => null);
const android = () => wretch("/app/latest.json").get().json().then((j) => parseAndroid(j) ?? null).catch(() => null);

const TBC = <span className="tbc">to be confirmed</span>;

function Requirements() {
  return (
    <table className="spec">
      <caption className="sr-only">Requirements by platform</caption>
      <thead>
        <tr><th scope="col">Platform</th><th scope="col">Requirement</th><th scope="col">How you install it</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Windows</th><td>Windows 10 or 11, 64-bit (x64) only</td><td>.exe installer</td></tr>
        <tr><th scope="row">Fire TV</th><td>Fire OS 6 or later (Android 7+) {TBC}</td><td>.apk, installed with Downloader</td></tr>
        <tr><th scope="row">Phones and tablets</th><td>Not supported for now</td><td>None</td></tr>
      </tbody>
    </table>
  );
}

/** The SmartScreen note. Copy flips with SIGNED in site.ts. */
export function WindowsNote({ signed = SIGNED }: { signed?: boolean }) {
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
    <p>
      On Fire TV you install the app with the free Downloader app, using a Downloader code. Downloader code: <b>shared with beta testers</b>. Open the app afterwards, choose Sign in, and enter the code it shows on <a href="/link">evicted.dev/link</a>.
    </p>
  );
}

const NoChannels = () => <p className="note">{PRODUCT_NAME} is a player only. It ships no channels, playlists or streams, and does not recommend providers. You add a source you are entitled to use.</p>;

/** Waitlist state: no download exists yet, so this page is the sign-up. */
function ComingSoon({ signed }: { signed: boolean }) {
  return (
    <article className="wrap page prose dl">
      <div className="dl-head">
        <h1>{`Join the ${PRODUCT_NAME} beta`}</h1>
        <p className="lead">{PRODUCT_NAME} is in private beta for Windows and Fire TV and can't be downloaded yet. Join the waitlist and we'll email you when the beta opens.</p>
      </div>
      <section id="waitlist" aria-labelledby="waitlist-h" className="block dl-form">
        <h2 id="waitlist-h">Join the waitlist</h2>
        <WaitlistForm />
      </section>
      <div className="dl-rest">
        <section id="beta" aria-labelledby="beta-h" className="block">
          <h2 id="beta-h">What the beta is</h2>
          <p>The beta is free. It covers the Windows app and the Fire TV app. When it opens we'll email an invitation to everyone on the list, in batches. Windows testers download the installer from this site. Fire TV testers install the app with Downloader, using a code we share with beta testers.</p>
        </section>
        <section id="requirements" aria-labelledby="requirements-h" className="block">
          <h2 id="requirements-h">Requirements</h2>
          <Requirements />
          <p className="note">Some values are still to be confirmed. We'll fill them in once we have tested on real hardware.</p>
        </section>
        <section id="windows" aria-labelledby="windows-h" className="block">
          <h2 id="windows-h">Windows</h2>
          <WindowsNote signed={signed} />
        </section>
        <section id="fire-tv" aria-labelledby="fire-tv-h" className="block">
          <h2 id="fire-tv-h">Fire TV</h2>
          <FireTvNote />
        </section>
        <section id="no-channels" aria-labelledby="no-channels-h" className="block">
          <h2 id="no-channels-h">No channels shipped</h2>
          <p>{PRODUCT_NAME} ships no channels. It doesn't include a playlist, a provider or a subscription, and we can't supply one. You bring a source you are entitled to use. See <a href="/setup">how to add one</a>.</p>
        </section>
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
    <article className="wrap page prose">
      <h1>Download {PRODUCT_NAME}</h1>
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
        <h2>Fire TV</h2>
        {tv.data ? (
          <>
            <a className="button" href={`/app/${tv.data.file}`}>Download for Fire TV</a>
            <p className="note">File <code>{tv.data.file}</code></p>
            <Sha value={tv.data.sha256} />
          </>
        ) : (
          <p className="note">{tv.isPending ? "Checking..." : "Not available right now."}</p>
        )}
        {/* Plain anchor (not router Link) so the page renders without a router in tests. */}
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
