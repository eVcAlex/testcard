import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, type IconName } from "../components/Icon.js";
import { AddSourceForm } from "../AddSourceForm.js";
import type { Theme } from "./useTheme.js";

export type BrowseTab = "live" | "favourites" | "recent";

const TABS: { id: BrowseTab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "favourites", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
];

export function Sidebar({
  tab,
  onTab,
  theme,
  onToggleTheme,
}: {
  tab: BrowseTab;
  onTab: (tab: BrowseTab) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const queryClient = useQueryClient();
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });

  const refresh = useMutation({
    mutationFn: (sourceId: string) => window.testcard.sources.refresh(sourceId),
    onSuccess: (result) => {
      setRefreshMsg(
        `${result.channels.toLocaleString()} channels · ${result.categories} categories`,
      );
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (error: unknown) => {
      setRefreshMsg(error instanceof Error ? error.message : "Refresh failed.");
    },
  });

  return (
    <aside className="pw-sidebar">
      <h1 className="pw-brand">
        TEST<span>CARD</span>
      </h1>

      <nav className="pw-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="pw-nav-item"
            data-active={t.id === tab}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} filled={t.id === "favourites" && tab === "favourites"} />
            {t.label}
          </button>
        ))}
      </nav>

      <p className="pw-nav-group">Sources</p>
      <div className="pw-sources">
        {sources.data?.length === 0 && !addOpen && (
          <p className="pw-source" style={{ color: "var(--ink-faint)" }}>
            No source yet
          </p>
        )}
        {sources.data?.map((source) => (
          <div key={source.id} className="pw-source">
            <span className="pw-source-name">{source.name}</span>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label={`Refresh ${source.name}`}
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(source.id)}
            >
              <Icon name="refresh" />
            </button>
          </div>
        ))}
        {refresh.isPending && <p className="pw-refresh-note">Fetching playlist…</p>}
        {!refresh.isPending && refreshMsg !== null && <p className="pw-refresh-note">{refreshMsg}</p>}

        {addOpen ? (
          <div style={{ padding: "var(--s-2) var(--s-3) 0" }}>
            <AddSourceForm
              onAdded={() => {
                setAddOpen(false);
                void queryClient.invalidateQueries({ queryKey: ["sources"] });
              }}
            />
          </div>
        ) : (
          <button type="button" className="pw-nav-item" onClick={() => setAddOpen(true)}>
            <Icon name="plus" />
            Add source
          </button>
        )}
      </div>

      <div className="pw-sidebar-foot">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </aside>
  );
}
