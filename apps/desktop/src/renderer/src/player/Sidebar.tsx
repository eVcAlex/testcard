import { Icon, type IconName } from "../components/Icon.js";
import { useSyncStatus } from "./AccountView.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { useUpdateState } from "./UpdatePanel.js";
import { useSources } from "./useSources.js";
import type { Theme } from "./useTheme.js";

export type BrowseTab = "live" | "movies" | "series" | "favourites" | "recent" | "account";

const TABS: { id: BrowseTab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "movies", label: "Movies", icon: "film" },
  { id: "series", label: "Series", icon: "layers" },
  { id: "favourites", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
  { id: "account", label: "Account", icon: "user" },
];

export function Sidebar({
  tab,
  onTab,
  sourceId,
  onSource,
  theme,
  onToggleTheme,
}: {
  tab: BrowseTab;
  onTab: (tab: BrowseTab) => void;
  sourceId: string | null;
  onSource: (sourceId: string | null) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const sync = useSyncStatus();
  const update = useUpdateState();
  const updateWaiting = update?.status === "available" || update?.status === "downloading" || update?.status === "ready";
  const sourceCount = useSources();

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
            data-active={t.id === tab}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} filled={t.id === "favourites" && tab === "favourites"} />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="pw-sidebar-fill" />

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
