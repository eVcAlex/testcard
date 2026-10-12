import type { PinKind } from "@testcard/core";
import type { RailList } from "@testcard/core/src/epg/guideGrid.js";
import { Icon } from "../components/Icon.js";
import { isPinnable, usePins } from "./usePins.js";

/** The left rail of categories on Movies and Series, the same look as Live TV's: Home, then lists (a section per source when several). */
export function CategoryRail({ lists, value, onPick, pinKind }: { lists: readonly RailList[]; value: string; onPick: (id: string) => void; pinKind: PinKind }) {
  const pins = usePins(pinKind);
  return (
    <aside className="lt-rail" aria-label="Categories">
      <div className="lt-rail-scroll">
        {lists.map((list, i) => (
          <div key={list.id}>
            {list.section !== undefined && list.section !== lists[i - 1]?.section && <p className="pw-nav-group">{list.section}</p>}
            <div className="pw-cat-row">
              <button type="button" className="pw-cat" data-active={value === list.id} onClick={() => onPick(list.id)} title={list.label}>
                <span className="pw-cat-name">{list.label}</span>
                <span className="pw-cat-count">{list.count}</span>
              </button>
              {isPinnable(list.id) && <PinButton pinned={pins.pinned.has(list.id)} label={list.label} onToggle={() => pins.toggle(list.id, list.label)} />}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Pins a rail category to Home; shows on hover, and stays while it is pinned. */
export function PinButton({ pinned, label, onToggle }: { pinned: boolean; label: string; onToggle: () => void }) {
  const text = pinned ? `Unpin ${label} from Home` : `Pin ${label} to Home`;
  return (
    <button type="button" className="pw-cat-pin" data-pinned={pinned} aria-label={text} title={text} onClick={onToggle}>
      <Icon name="pin" size={13} filled={pinned} />
    </button>
  );
}
