import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/Icon.js";
import { formatRelative } from "../lib/time.js";
import { sourceHost, sourceInitial } from "../lib/source.js";
import type { SourceListItem } from "../../../shared/ipc.js";

/**
 * One source card on the Sources screen: avatar, name + kind pill, host, refresh status, and a
 * kebab menu (Refresh / Edit / Remove). Each card owns its own refresh/remove mutation state —
 * a slow refresh on one source doesn't disable the others.
 */
export function SourceCard({
  source,
  onEdit,
  onSettings,
}: {
  source: SourceListItem;
  onEdit: () => void;
  onSettings: () => void;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Closing the menu (e.g. picking "Edit") shouldn't leave a stale confirm state behind.
  useEffect(() => {
    if (!menuOpen) setConfirmingRemove(false);
  }, [menuOpen]);

  // Live import progress for THIS source, pushed from main during its refresh — channels/VOD/
  // series/guide each report their own phase, so the card doesn't sit blank between them.
  useEffect(() => {
    if (!window.testcard?.events?.onTask) return;
    return window.testcard.events.onTask((event) => {
      if (event.sourceId !== source.id) return;
      if (event.type === "epg") {
        if (event.phase === "parsing" && event.programmes) {
          setRefreshMsg(`Guide: ${event.programmes.toLocaleString()} programmes…`);
        } else if (event.phase === "error" && event.message) {
          setRefreshMsg(`Guide: ${event.message}`);
        }
      } else if (event.type === "vod") {
        if (event.phase === "fetching") setRefreshMsg("Movies: updating…");
        else if (event.phase === "error" && event.message) setRefreshMsg(`Movies: ${event.message}`);
      } else if (event.type === "series") {
        if (event.phase === "fetching") setRefreshMsg("Series: updating…");
        else if (event.phase === "error" && event.message) setRefreshMsg(`Series: ${event.message}`);
      }
    });
  }, [source.id]);

  const refresh = useMutation({
    mutationFn: () => window.testcard.sources.refresh(source.id),
    onSuccess: (result) => {
      const parts = [`${result.channels.toLocaleString()} channels · ${result.categories} categories`];
      if (result.programmes !== undefined) parts.push(`${result.programmes.toLocaleString()} programmes`);
      setRefreshMsg(parts.join(" · "));
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["epg"] });
      void queryClient.invalidateQueries({ queryKey: ["movies"] });
      void queryClient.invalidateQueries({ queryKey: ["series"] });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error: unknown) => {
      setRefreshMsg(error instanceof Error ? error.message : "Refresh failed.");
    },
  });

  // A source can be importing without this card having asked (first import after adding it, a
  // scheduled refresh, arriving from another device); main reports it via the source list.
  const importing = refresh.isPending || source.refreshing === true;
  const wasRefreshing = useRef(false);
  useEffect(() => {
    const now = source.refreshing === true;
    if (now && !wasRefreshing.current) setRefreshMsg(null);
    if (!now && wasRefreshing.current) {
      for (const key of ["channels", "categories", "epg", "movies", "series"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
    wasRefreshing.current = now;
  }, [source.refreshing, queryClient]);

  const remove = useMutation({
    mutationFn: () => window.testcard.sources.remove(source.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  return (
    <li className="pw-src-card">
      <span className="pw-src-avatar" aria-hidden="true">
        {sourceInitial(source)}
      </span>

      <div className="pw-src-body">
        <div className="pw-src-title">
          <span className="pw-src-name">{source.name}</span>
          <span className="pill">{source.kind === "xtream" ? "XTREAM" : "M3U"}</span>
        </div>
        <span className="pw-src-host">{sourceHost(source)}</span>
        <div className="pw-src-meta">
          <span>
            <Icon name="clock" size={12} />
            {source.lastRefreshedAt !== undefined
              ? `Refreshed ${formatRelative(source.lastRefreshedAt)}`
              : "Never refreshed"}
          </span>
          {source.refreshIntervalHours !== undefined && (
            <span>
              <Icon name="refresh" size={12} />
              Every {source.refreshIntervalHours}h
            </span>
          )}
        </div>

        {importing && <p className="pw-refresh-note">{refreshMsg ?? "Fetching playlist…"}</p>}
        {!importing && refreshMsg !== null && <p className="pw-refresh-note">{refreshMsg}</p>}
        {!importing && refreshMsg === null && source.refreshError !== undefined && (
          <p className="msg msg--error">{source.refreshError}</p>
        )}
        {remove.isError && <p className="msg msg--error">{(remove.error as Error).message}</p>}
      </div>

      <div className="pw-source-menu" ref={menuRef}>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={`${source.name} actions`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="more" />
        </button>
        {menuOpen && (
          <div className="pw-source-menu-pop" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={importing}
              onClick={() => {
                setMenuOpen(false);
                setRefreshMsg(null);
                refresh.mutate();
              }}
            >
              <Icon name="refresh" />
              {importing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSettings();
              }}
            >
              <Icon name="grid" />
              Settings
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Icon name="edit" />
              Edit connection
            </button>
            <button
              type="button"
              role="menuitem"
              className="pw-source-menu-danger"
              disabled={remove.isPending}
              onClick={() => {
                if (!confirmingRemove) {
                  setConfirmingRemove(true);
                  return;
                }
                remove.mutate();
              }}
            >
              <Icon name="trash" />
              {remove.isPending ? "Removing…" : confirmingRemove ? "Click again to confirm" : "Remove"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
