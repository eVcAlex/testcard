import { useState } from "react";
import { Icon } from "../components/Icon.js";
import { logoSrc } from "../lib/logo.js";
import { splitTitle } from "../lib/title.js";

/** The minimal shape `PosterGrid` needs — `MoviesView`/`SeriesView` map their rows into this. */
export interface PosterItem {
  readonly id: string;
  readonly name: string;
  readonly posterUrl: string | null;
  readonly watched?: boolean;
  readonly favourite?: boolean;
  /** How far through, 0–1. Only shown for something started and not finished. */
  readonly progress?: number | null;
}

export function PosterCard({ item, onSelect }: { item: PosterItem; onSelect: (id: string) => void }) {
  const { title, year, is4k } = splitTitle(item.name);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const showImage = item.posterUrl !== null && item.posterUrl !== "" && !broken;
  const progress = item.progress !== undefined && item.progress !== null && !item.watched ? Math.min(1, Math.max(0, item.progress)) : null;
  return (
    <button type="button" className="pw-poster-card" onClick={() => onSelect(item.id)} title={item.name}>
      <span className="pw-poster-image" data-loading={showImage && !loaded}>
        {showImage ? (
          <img
            src={logoSrc(item.posterUrl)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            data-loaded={loaded}
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="pw-poster-fallback">
            <Icon name="film" size={22} />
            <span>{title}</span>
          </span>
        )}
        <span className="pw-poster-play" aria-hidden="true">
          <Icon name="play" size={18} />
        </span>
        {is4k && <span className="pw-poster-tag">4K</span>}
        {item.favourite === true && (
          <span className="pw-poster-fav" aria-label="Favourite">
            <Icon name="star" size={12} filled />
          </span>
        )}
        {item.watched === true && (
          <span className="pw-poster-watched" aria-label="Watched">
            <Icon name="check" size={12} />
          </span>
        )}
        {progress !== null && progress > 0 && (
          <span className="pw-poster-progress" aria-hidden="true">
            <i style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </span>
      <span className="pw-poster-title">{title}</span>
      {year !== null && <span className="pw-poster-year">{year}</span>}
    </button>
  );
}

export function PosterGrid({
  items,
  onSelect,
}: {
  items: readonly PosterItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="pw-poster-grid">
      {items.map((item) => (
        <PosterCard key={item.id} item={item} onSelect={onSelect} />
      ))}
    </div>
  );
}
