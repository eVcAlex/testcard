import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, type IconName } from "../components/Icon.js";
import { AddSourceForm } from "../AddSourceForm.js";
import type { Theme } from "./useTheme.js";

export type BrowseTab = "live" | "guide" | "favourites" | "recent";

const TABS: { id: BrowseTab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "guide", label: "Guide", icon: "grid" },
  { id: "favourites", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
];

export function Sidebar({
  tab,
  onTab,
  categoryId,
  onCategory,
  theme,
  onToggleTheme,
}: {
  tab: BrowseTab;
  onTab: (tab: BrowseTab) => void;
  categoryId: string | null;
  onCategory: (categoryId: string | null) => void;
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

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => window.testcard.channels.categoryList(),
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: (sourceId: string) => window.testcard.sources.refresh(sourceId),
    onSuccess: (result) => {
      const parts = [
        `${result.channels.toLocaleString()} channels · ${result.categories} categories`,
      ];
      if (result.programmes !== undefined) parts.push(`${result.programmes.toLocaleString()} programmes`);
      setRefreshMsg(parts.join(" · "));
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["epg"] });
    },
    onError: (error: unknown) => {
      setRefreshMsg(error instanceof Error ? error.message : "Refresh failed.");
    },
  });

  // Live guide-import progress, pushed from main during a refresh.
  useEffect(() => {
    if (!window.testcard?.events?.onTask) return;
    return window.testcard.events.onTask((event) => {
      if (event.type !== "epg") return;
      if (event.phase === "parsing" && event.programmes) {
        setRefreshMsg(`Guide: ${event.programmes.toLocaleString()} programmes…`);
      } else if (event.phase === "error" && event.message) {
        setRefreshMsg(`Guide: ${event.message}`);
      }
    });
  }, []);

  const pickCategory = (id: string | null) => {
    onCategory(id);
    // Stay in the guide if that's where the user is; otherwise show the channel grid.
    if (tab !== "guide") onTab("live");
  };

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
            data-active={t.id === tab && (t.id !== "live" || categoryId === null)}
            onClick={() => {
              onTab(t.id);
              if (t.id === "live") onCategory(null);
            }}
          >
            <Icon name={t.icon} filled={t.id === "favourites" && tab === "favourites"} />
            {t.label}
          </button>
        ))}
      </nav>

      <p className="pw-nav-group">Sources</p>
      <div className="pw-sources">
        {sources.data?.length === 0 && !addOpen && (
          <p className="pw-source-empty">No source yet</p>
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
          <div className="pw-source-add">
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

      <p className="pw-nav-group">Categories</p>
      <div className="pw-cats">
        <button
          type="button"
          className="pw-cat"
          data-active={tab === "live" && categoryId === null}
          onClick={() => pickCategory(null)}
        >
          <span className="pw-cat-name">All channels</span>
        </button>
        {categories.data?.map((category) => (
          <button
            key={category.id}
            type="button"
            className="pw-cat"
            data-active={categoryId === category.id}
            onClick={() => pickCategory(category.id)}
            title={category.name}
          >
            {category.country && <span className="pw-cat-cc">{category.country}</span>}
            <span className="pw-cat-name">{category.name}</span>
            <span className="pw-cat-count">{category.channel_count}</span>
          </button>
        ))}
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
