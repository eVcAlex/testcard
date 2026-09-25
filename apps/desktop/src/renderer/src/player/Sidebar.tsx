import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "../components/Icon.js";
import { useSyncStatus } from "./AccountView.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { useUpdateState } from "./UpdatePanel.js";
import { useSources } from "./useSources.js";
import type { Theme } from "./useTheme.js";

export type BrowseTab = "live" | "guide" | "movies" | "series" | "favourites" | "recent" | "account";

const TABS: { id: BrowseTab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "guide", label: "Guide", icon: "grid" },
  { id: "movies", label: "Movies", icon: "film" },
  { id: "series", label: "Series", icon: "layers" },
  { id: "favourites", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
  { id: "account", label: "Account", icon: "user" },
];

export function Sidebar({
  tab,
  onTab,
  categoryId,
  onCategory,
  sourceId,
  onSource,
  theme,
  onToggleTheme,
}: {
  tab: BrowseTab;
  onTab: (tab: BrowseTab) => void;
  categoryId: string | null;
  onCategory: (categoryId: string | null) => void;
  sourceId: string | null;
  onSource: (sourceId: string | null) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const sync = useSyncStatus();
  const update = useUpdateState();
  const updateWaiting = update?.status === "available" || update?.status === "downloading" || update?.status === "ready";
  const sourceCount = useSources();

  // Live categories only mean something while browsing channels; on Movies/Series/Account they
  // would just be a second, unrelated list beside the page's own filters.
  const showCategories = tab === "live" || tab === "guide";

  const categories = useQuery({
    queryKey: ["categories", sourceId],
    queryFn: () => window.testcard.channels.categoryList(sourceId ?? undefined),
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

      <ProfileSwitcher onManage={() => onTab("account")} />

      {(sourceCount.data?.length ?? 0) > 1 && (
        <label className="pw-source-pick">
          <span>Source</span>
          <select
            className="input"
            value={sourceId ?? ""}
            onChange={(event) => onSource(event.target.value === "" ? null : event.target.value)}
            aria-label="Show content from"
          >
            <option value="">All sources</option>
            {sourceCount.data?.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
      )}

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

      {showCategories ? (
        <>
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
        </>
      ) : (
        <div className="pw-sidebar-fill" />
      )}

      <div className="pw-sidebar-foot">
        <button
          type="button"
          className="pw-account-chip"
          data-active={tab === "account"}
          onClick={() => onTab("account")}
          title="Account and sources"
        >
          <span className="pw-account-dot" data-state={sync.data?.account === "signed-in" ? (sync.data.lastError ? "error" : "ok") : "off"} aria-hidden="true" />
          <span className="pw-account-chip-text">
            {sync.data?.account === "signed-in" ? sync.data.email : "Not signed in"}
            <small>
              {updateWaiting ? "Update available" : sourceCount.data === undefined
                ? ""
                : `${sourceCount.data.length} ${sourceCount.data.length === 1 ? "source" : "sources"}`}
            </small>
          </span>
        </button>
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
