import { PosterCard, type PosterItem } from "./PosterGrid.js";

/** One landing-page row: a title, an optional "See all", and posters that scroll sideways. */
export function PosterShelf({
  title,
  items,
  onSelect,
  onSeeAll,
}: {
  title: string;
  items: readonly PosterItem[];
  onSelect: (id: string) => void;
  onSeeAll?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="pw-shelf">
      <div className="pw-shelf-head">
        <h3 className="pw-shelf-title">{title}</h3>
        {onSeeAll !== undefined && (
          <button type="button" className="btn btn--ghost pw-shelf-all" onClick={onSeeAll}>
            See all
          </button>
        )}
      </div>
      <div className="pw-shelf-row pw-shelf-row--posters">
        {items.map((item) => (
          <PosterCard key={item.id} item={item} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}
