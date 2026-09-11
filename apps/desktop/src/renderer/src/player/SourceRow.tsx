import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/Icon.js";
import { SourceForm } from "../SourceForm.js";
import { formatRelative } from "../lib/time.js";
import type { SourceListItem } from "../../../shared/ipc.js";

/**
 * One sidebar source row: name + last-refreshed time + a kebab menu (Refresh / Edit / Remove).
 * Each row owns its own refresh/remove mutation state — no more one shared `isPending` that
 * disabled every row in the list while any single source refreshed.
 */
export function SourceRow({ source }: { source: SourceListItem }) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
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

  // Live guide-import progress for THIS source, pushed from main during its refresh.
  useEffect(() => {
    if (!window.testcard?.events?.onTask) return;
    return window.testcard.events.onTask((event) => {
      if (event.type !== "epg" || event.sourceId !== source.id) return;
      if (event.phase === "parsing" && event.programmes) {
        setRefreshMsg(`Guide: ${event.programmes.toLocaleString()} programmes…`);
      } else if (event.phase === "error" && event.message) {
        setRefreshMsg(`Guide: ${event.message}`);
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
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error: unknown) => {
      setRefreshMsg(error instanceof Error ? error.message : "Refresh failed.");
    },
  });

  const remove = useMutation({
    mutationFn: () => window.testcard.sources.remove(source.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  if (editing) {
    return (
      <div className="pw-source-add">
        <SourceForm source={source} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="pw-source">
      <div className="pw-source-row">
        <span className="pw-source-name">{source.name}</span>
        {source.lastRefreshedAt !== undefined && (
          <span className="pw-source-refreshed">{formatRelative(source.lastRefreshedAt)}</span>
        )}
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
                disabled={refresh.isPending}
                onClick={() => {
                  setMenuOpen(false);
                  refresh.mutate();
                }}
              >
                <Icon name="refresh" />
                {refresh.isPending ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setEditing(true);
                }}
              >
                <Icon name="edit" />
                Edit
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
      </div>

      {refresh.isPending && <p className="pw-refresh-note">Fetching playlist…</p>}
      {!refresh.isPending && refreshMsg !== null && <p className="pw-refresh-note">{refreshMsg}</p>}
      {remove.isError && <p className="msg msg--error">{(remove.error as Error).message}</p>}
    </div>
  );
}
