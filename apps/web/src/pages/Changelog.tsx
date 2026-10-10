import { Link } from "@tanstack/react-router";
import { DOWNLOADER_CODE, PRODUCT_NAME } from "../site.ts";
import { BackChip } from "../ui/parts.tsx";

/** Newest first. Add an entry per release; keep the wording to what a user can see. */
const ENTRIES = [
  { date: "10 October 2026", title: "Android TV and Fire TV beta", body: `The beta for Android TV and Fire TV can be installed now with the Downloader app and the code ${DOWNLOADER_CODE}. Android TV and Fire TV boxes with Android 7 or later are supported.` },
] as const;

export function Changelog() {
  return (
    <article className="page-in wrap prose">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>What's new</h1>
      <p className="case-lede" data-rise>Changes to {PRODUCT_NAME}, newest first. The Windows beta is not out yet: <Link to="/download">join the waitlist</Link>.</p>
      <ol className="changelog">
        {ENTRIES.map((e) => (
          <li key={e.date} className="block" data-rise>
            <p className="note"><time>{e.date}</time></p>
            <h2>{e.title}</h2>
            <p>{e.body}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
