type ShotData = { src: string; alt: string; caption: string; width: number; height: number };

// Made from invented demo content (scripts/screenshots). Files live in apps/web/public/shots/.
export const TV_GUIDE: ShotData = { src: "/shots/tv-guide.webp", alt: "The Testcard TV guide on a Fire TV: a timeline of programmes across several channels, with the current programme highlighted.", caption: "The TV guide on Fire TV, with what is on now across your channels.", width: 1600, height: 900 };
export const DESKTOP_LIVE: ShotData = { src: "/shots/desktop-live.webp", alt: "The Testcard desktop app on Live TV: a category list, a channel preview and a programme guide grid.", caption: "Live TV on Windows, with the guide beside the channel list.", width: 1600, height: 900 };
export const DESKTOP_MOVIES: ShotData = { src: "/shots/desktop-movies.webp", alt: "The Testcard desktop app on Movies: poster shelves grouped by category with titles and years.", caption: "Movies on Windows, browsed by category.", width: 1600, height: 900 };

/** A screenshot framed in the TV palette. */
export function Shot({ shot, className }: { shot: ShotData; className?: string }) {
  return (
    <figure className={`hm-shot${className ? ` ${className}` : ""}`}>
      <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" decoding="async" />
      <figcaption>{shot.caption}</figcaption>
    </figure>
  );
}
