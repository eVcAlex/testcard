import { useQuery } from "@tanstack/react-query";
import wretch from "wretch";
import { parseAndroid, parseDesktop } from "../releases.ts";

// null, not undefined: TanStack Query v5 treats undefined data as an error (and retries).
const desktop = () => wretch("/app/latest.yml").get().text().then((t) => parseDesktop(t) ?? null).catch(() => null);
const android = () => wretch("/app/latest.json").get().json().then((j) => parseAndroid(j) ?? null).catch(() => null);

export function Download() {
  const win = useQuery({ queryKey: ["desktop"], queryFn: desktop });
  const tv = useQuery({ queryKey: ["firetv"], queryFn: android });
  return (
    <section>
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
