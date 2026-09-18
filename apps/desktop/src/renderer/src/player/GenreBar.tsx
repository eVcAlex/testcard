import type { GenreOption } from "../lib/genres.js";

/** A row of genre chips derived from the stored category classification. Advisory: absent when there's nothing useful to filter by. */
export function GenreBar({
  options,
  value,
  onChange,
}: {
  options: readonly GenreOption[];
  value: string | null;
  onChange: (genre: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="pw-catbar pw-genrebar" role="group" aria-label="Genre">
      <button type="button" className="pw-chip" data-active={value === null} onClick={() => onChange(null)}>
        Any genre
      </button>
      {options.map((option) => (
        <button
          key={option.genre}
          type="button"
          className="pw-chip"
          data-active={value === option.genre}
          onClick={() => onChange(option.genre)}
        >
          {option.label}
          <span className="pw-chip-count">{option.count.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}
