/**
 * One row of category chips that scrolls sideways instead of wrapping into a wall — providers ship
 * dozens of categories. The active chip scrolls into view when it changes.
 */
import { useEffect, useRef } from "react";

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

export function CategoryBar({
  allLabel,
  categories,
  value,
  onChange,
}: {
  allLabel: string;
  categories: readonly CategoryOption[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [value]);

  return (
    <div className="pw-catbar" role="group" aria-label="Category">
      <button
        ref={value === null ? activeRef : undefined}
        type="button"
        className="pw-chip"
        data-active={value === null}
        onClick={() => onChange(null)}
      >
        {allLabel}
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          ref={value === category.id ? activeRef : undefined}
          type="button"
          className="pw-chip"
          data-active={value === category.id}
          onClick={() => onChange(category.id)}
          title={category.name}
        >
          {category.name}
          <span className="pw-chip-count">{category.count}</span>
        </button>
      ))}
    </div>
  );
}
