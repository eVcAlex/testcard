import { useQuery } from "@tanstack/react-query";
import wretch from "wretch";
import { parseAndroid, parseDesktop } from "../releases.ts";
import { CONTACT_EMAIL, RELEASE_STATE, type ReleaseState } from "../site.ts";

// null, not undefined: TanStack Query v5 treats undefined data as an error (and retries).
const desktop = () => wretch("/app/latest.yml").get().text().then((t) => parseDesktop(t) ?? null).catch(() => null);
const android = () => wretch("/app/latest.json").get().json().then((j) => parseAndroid(j) ?? null).catch(() => null);

/** Waitlist state: no download exists yet. The waitlist form (a later change) replaces the mailto stub inside #waitlist. */
function ComingSoon() {
  return (
    <section className="wrap page">
      <h1>Download Testcard</h1>
      <p className="lead">Testcard is in private beta for Windows and Fire TV, and isn't available to download yet.</p>
      <div id="waitlist">
        <p>To join the beta waitlist, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </div>
    </section>
  );
}

export function Download({ state = RELEASE_STATE }: { state?: ReleaseState }) {
  return state === "waitlist" ? <ComingSoon /> : <Releases />;
}

function Releases() {
  const win = useQuery({ queryKey: ["desktop"], queryFn: desktop });
  const tv = useQuery({ queryKey: ["firetv"], queryFn: android });
  return (
    <section className="wrap page">
      <h1>Download</h1>
      <div className="card">
        <h2>Windows</h2>
        {win.data ? <a className="button" href={`/app/${win.data.file}`}>Download for Windows {win.data.version}</a> : <p className="note">{win.isPending ? "Checking..." : "Not available right now."}</p>}
      </div>
      <div className="card">
        <h2>Fire TV</h2>
        {tv.data ? <a className="button" href={`/app/${tv.data.file}`}>Download for Fire TV</a> : <p className="note">{tv.isPending ? "Checking..." : "Not available right now."}</p>}
        {/* Plain anchor (not router Link) so the page renders without a router in tests. */}
        <p className="note">Open the app, choose Sign in, and enter the code on <a href="/link">evicted.dev/link</a>.</p>
      </div>
    </section>
  );
}
