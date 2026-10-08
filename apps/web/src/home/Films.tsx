import { Shot } from "./shots.tsx";

const FACTS = [
  ["Films", "Browse by category, with posters, titles and years."],
  ["Series", "Seasons and episodes in the same app, and a Next episode button on Fire TV."],
  ["Catch-up", "Go back in time on channels where your provider keeps an archive."],
] as const;

/** The one full-width section: the screenshot is the evidence, the three facts hang under it in a ruled row. */
export function Films() {
  return (
    <section className="section" aria-labelledby="hm-films">
      <div className="wrap">
        <div className="hm-films-head">
          <h2 id="hm-films">Films, series and catch-up.</h2>
          <p>Live TV is the front door, not the whole house. Everything your source offers sits in one place.</p>
        </div>
        <Shot file="desktop-movies.webp" className="hm-shot-wide" />
        <dl className="hm-facts hm-facts-row">
          {FACTS.map(([t, d]) => (<div key={t}><dt>{t}</dt><dd>{d}</dd></div>))}
        </dl>
      </div>
    </section>
  );
}
