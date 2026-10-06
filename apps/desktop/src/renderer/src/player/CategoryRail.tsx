import type { RailList } from "@testcard/core/src/epg/guideGrid.js";

/** The left rail of categories on Movies and Series, the same look as Live TV's: Home, then lists (a section per source when several). */
export function CategoryRail({ lists, value, onPick }: { lists: readonly RailList[]; value: string; onPick: (id: string) => void }) {
  return (
    <aside className="lt-rail" aria-label="Categories">
      <div className="lt-rail-scroll">
        {lists.map((list, i) => (
          <div key={list.id}>
            {list.section !== undefined && list.section !== lists[i - 1]?.section && <p className="pw-nav-group">{list.section}</p>}
            <button type="button" className="pw-cat" data-active={value === list.id} onClick={() => onPick(list.id)} title={list.label}>
              <span className="pw-cat-name">{list.label}</span>
              <span className="pw-cat-count">{list.count}</span>
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
