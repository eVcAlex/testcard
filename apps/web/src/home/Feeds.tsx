import { useState } from "react";

const FEEDS = ["4K", "FHD", "HD"] as const;

/** A diagram, not a recording: drop the playing feed and the next one takes over. Pure state, so it renders the same on the server. */
export function Feeds() {
  const [dropped, setDropped] = useState(0);
  const playing = FEEDS[dropped]!;
  const status = dropped === 0 ? `Playing the ${playing} feed.` : `${FEEDS.slice(0, dropped).join(" and ")} dropped. Fell back to ${playing} automatically.`;
  const done = dropped >= FEEDS.length - 1;
  return (
    <section className="section" aria-labelledby="hm-feeds">
      <div className="wrap hm-two hm-rev">
        <div className="hm-copy">
          <h2 id="hm-feeds">One channel, every feed.</h2>
          <p>Sources often list the same channel several times: 4K, FHD, HD. Testcard groups them under one channel in the guide. On Fire TV, when the feed you are watching fails it tries the next one for you.</p>
          <p className="note">A diagram, not a recording. Press the button.</p>
        </div>
        <div className="hm-fb frame tv">
          <div className="hm-fb-ch"><b>Peak Sport</b><small>one row in the guide</small></div>
          <span className="hm-fb-link" aria-hidden="true" />
          <ul className="hm-fb-feeds" aria-label="Feeds grouped under Peak Sport">
            {FEEDS.map((q, i) => {
              const state = i < dropped ? "failed" : i === dropped ? "playing" : "standby";
              return <li key={q} data-state={state}><b>{q}</b><span>{state}</span></li>;
            })}
          </ul>
          <p className="hm-fb-status" role="status">{status}</p>
          <button type="button" className="button ghost hm-fb-btn" onClick={() => setDropped(done ? 0 : dropped + 1)}>
            {done ? "Bring the feeds back" : `Drop the ${playing} feed`}
          </button>
        </div>
      </div>
    </section>
  );
}
