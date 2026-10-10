import { Bars } from "./parts.tsx";

const FRAMES = ["tv-movies", "tv-guide", "desktop-live", "desktop-movies"];

/**
 * The opening: a small square flicks through the app's real screens, then gets out of the way. It is plain CSS keyframes
 * (see .pl in styles.css), so it needs no script, cannot get stuck, and is skipped on the calm layout and for a tab that has
 * already seen it (html.no-intro, set by theme-init.js).
 */
export function Preloader() {
  return (
    <div className="pl" aria-hidden="true">
      <div className="pl-sq">
        {FRAMES.map((f) => <img key={f} className="pl-f" src={`/shots/${f}-s.webp`} alt="" width="480" height="270" decoding="async" loading="lazy" />)}
        <div className="pl-f pl-bars"><Bars /></div>
      </div>
    </div>
  );
}
