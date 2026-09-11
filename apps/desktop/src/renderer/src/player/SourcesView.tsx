import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "../components/Icon.js";
import { SourceForm } from "../SourceForm.js";
import { SourceCard } from "./SourceCard.js";
import type { SourceListItem } from "../../../shared/ipc.js";

type Pane = { mode: "list" } | { mode: "add" } | { mode: "edit"; source: SourceListItem };

/**
 * The Sources screen — a full main-pane view (same slot as `BrowseView`/`GuideView`), replacing
 * the old sidebar-embedded row list. Owns its own list/add/edit navigation locally, so nothing
 * above it (`PlayerScreen`) needs to know a form is open.
 */
export function SourcesView() {
  const [pane, setPane] = useState<Pane>({ mode: "list" });

  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });

  if (pane.mode !== "list") {
    return (
      <main className="pw-sources-view pw-main">
        <div className="pw-head">
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label="Back to sources"
            onClick={() => setPane({ mode: "list" })}
          >
            <Icon name="back" />
          </button>
          <h2>{pane.mode === "edit" ? "Edit source" : "Add source"}</h2>
        </div>
        <div className="pw-scroll">
          <div className="pw-source-form-wrap">
            <SourceForm
              {...(pane.mode === "edit" ? { source: pane.source } : {})}
              onDone={() => setPane({ mode: "list" })}
              onCancel={() => setPane({ mode: "list" })}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="pw-sources-view pw-main">
      <div className="pw-head">
        <h2>Sources</h2>
        <div className="pw-head-actions">
          <button type="button" className="btn btn--primary" onClick={() => setPane({ mode: "add" })}>
            <Icon name="plus" />
            Add source
          </button>
        </div>
      </div>
      <div className="pw-scroll">
        {sources.data?.length === 0 ? (
          <p className="pw-empty">No sources yet. Add one to start watching.</p>
        ) : (
          <ul className="pw-src-list">
            {sources.data?.map((source) => (
              <SourceCard key={source.id} source={source} onEdit={() => setPane({ mode: "edit", source })} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
