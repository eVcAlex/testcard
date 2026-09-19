import type { ReactNode } from "react";
import { Icon } from "../components/Icon.js";

/**
 * A tile with a small "x" that appears on hover or keyboard focus. A sibling of the tile rather than a
 * child, because the tiles are buttons and a button cannot hold a button.
 */
export function Removable({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="pw-removable">
      {children}
      <button type="button" className="pw-remove" aria-label={label} title={label} onClick={onRemove}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
