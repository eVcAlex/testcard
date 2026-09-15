import { Icon } from "../components/Icon.js";
import { logoSrc } from "../lib/logo.js";

/** The minimal shape `PosterGrid` needs — `MoviesView`/`SeriesView` map their rows into this. */
export interface PosterItem {
  readonly id: string;
  readonly name: string;
  readonly posterUrl: string | null;
  readonly watched?: boolean;
}

export function PosterGrid({
  items,
  onSelect,
  empty,
}: {
  items: readonly PosterItem[];
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="pw-empty">{empty}</p>;
  }
  return (
    <div className="pw-poster-grid">
      {items.map((item) => (
        <button key={item.id} type="button" className="pw-poster-card" onClick={() => onSelect(item.id)}>
          <span className="pw-poster-image">
            {item.posterUrl ? (
              <img src={logoSrc(item.posterUrl)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <Icon name="film" />
            )}
            {item.watched === true && (
              <span className="pw-poster-watched">
                <Icon name="check" size={12} />
              </span>
            )}
          </span>
          <span className="pw-poster-title">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
