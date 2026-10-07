import { useQuery } from "@tanstack/react-query";
import wretch from "wretch";
import { parseAndroid, parseDesktop } from "../releases.ts";

const desktop = () => wretch("/app/latest.yml").get().text().then(parseDesktop).catch(() => undefined);
const android = () => wretch("/app/latest.json").get().json().then(parseAndroid).catch(() => undefined);

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
        <p className="note">Open the app, choose Sign in, and enter the code on <a href="/link">evicted.dev/link</a>.</p>
      </div>
    </section>
  );
}
