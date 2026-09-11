import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "../components/Icon.js";
import type { Theme } from "./useTheme.js";

export type BrowseTab = "live" | "guide" | "favourites" | "recent" | "sources";

const TABS: { id: BrowseTab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "guide", label: "Guide", icon: "grid" },
  { id: "favourites", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
  { id: "sources", label: "Sources", icon: "signal" },
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
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => window.testcard.channels.categoryList(),
    staleTime: 60_000,
  });

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
            {t.id === "sources" && sources.data !== undefined && (
              <span className="pw-nav-count">{sources.data.length}</span>
            )}
          </button>
        ))}
      </nav>

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
