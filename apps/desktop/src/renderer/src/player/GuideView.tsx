import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import { railLists, segmentsFor, startList, type Airing, type RailList } from "@testcard/core/src/epg/guideGrid.js";
import type { ProgrammeLite } from "../../../shared/ipc.js";
import { Icon } from "../components/Icon.js";
import { logoSrc } from "../lib/logo.js";
import { formatClock } from "../lib/time.js";
import { PictureWell } from "./PictureWell.js";
import { useSources } from "./useSources.js";

const WINDOW_MIN = 120;
const SLOT_MIN = 30;
const PAGE_MIN = 60;
const ROW_H = 56;
const BLOCK = 20;
const CHANNELS_MOST = 5000;
/** How long the pointer must rest on a channel before the preview tunes to it (a held key flies past without opening streams). */
const TUNE_DELAY_MS = 800;

type Listing = Airing & { readonly description?: string };

const floorToSlot = (ms: number) => Math.floor(ms / (SLOT_MIN * 60_000)) * SLOT_MIN * 60_000;

/**
 * Live TV: the guide is the page. A rail of lists at the left (Favourites and Recently watched across every source, then one
 * section per source when there are several), a header with the focused channel playing muted in the preview frame and what is
 * on, and below it the guide, channels down the side and a two-hour window of programmes across. Click a programme to preview
 * the channel; double-click or Enter to watch full screen; right-click for the channel's options. Layout comes from
 * packages/core guideGrid.ts, the same code (and test vectors) as the Fire TV app.
 */
export function GuideView({
  sourceId,
  activeChannelId,
  inPlayer,
  onPlay,
  onListChange,
}: {
  sourceId: string | null;
  activeChannelId: string | null;
  /** The full-screen player is up: the preview frame gives up the video window and the preview stops. */
  inPlayer: boolean;
  onPlay: (channel: ChannelRow) => void;
  onListChange: (rows: readonly ChannelRow[]) => void;
}) {
  const queryClient = useQueryClient();
  const sources = useSources();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ---- the rail ----
  const sourceList = useMemo(() => sources.data ?? [], [sources.data]);
  const categoryKeys = useMemo(() => ["", ...sourceList.map((s) => s.id)], [sourceList]);
  const categoryQueries = useQueries({
    queries: categoryKeys.map((key) => ({
      queryKey: ["categories", key === "" ? undefined : key],
      queryFn: () => window.testcard.channels.categoryList(key === "" ? undefined : key),
      staleTime: 60_000,
    })),
  });
  const categoryStamp = categoryQueries.map((q) => q.dataUpdatedAt).join();
  const favouritesQuery = useQuery({ queryKey: ["channels", "favourites"], queryFn: () => window.testcard.channels.favourites() });
  const recentQuery = useQuery({ queryKey: ["channels", "recent"], queryFn: () => window.testcard.channels.recent() });
  const own = useCallback((rows: readonly ChannelRow[] | undefined) => (rows ?? []).filter((c) => sourceId === null || c.source_id === sourceId), [sourceId]);

  const lists = useMemo(
    () =>
      railLists({
        sourceId,
        sources: sourceList.map((s) => ({
          id: s.id,
          name: s.name,
          channels: (categoryQueries[categoryKeys.indexOf(s.id)]?.data ?? []).reduce((n, c) => n + c.channel_count, 0),
        })),
        categories: Object.fromEntries(
          categoryKeys.map((key, i) => [key, (categoryQueries[i]?.data ?? []).map((c) => ({ id: c.id, label: c.name, count: c.channel_count }))]),
        ),
        favourites: own(favouritesQuery.data).length,
        recents: own(recentQuery.data).length,
      }),
    // categoryQueries is a new array every render; when its data last changed is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceId, sourceList, categoryKeys, categoryStamp, favouritesQuery.data, recentQuery.data, own],
  );
  const ready = favouritesQuery.isSuccess && recentQuery.isSuccess && sources.isSuccess && categoryQueries.every((q) => q.isSuccess);

  // The starting list is chosen once: adding a first favourite must not swap the grid under the user.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (picked === null && ready) setPicked(startList(lists, null));
  }, [picked, ready, lists]);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);
  const searching = debounced.length > 0;
  const shown = searching ? "search" : startList(lists, picked);
  const shownLabel = searching ? "Search" : (lists.find((l) => l.id === shown)?.label ?? "Live TV");

  // ---- the channels of the shown list ----
  const channelsQuery = useQuery({
    queryKey: ["channels", "guide", shown, searching ? debounced : "", sourceId, favouritesQuery.dataUpdatedAt, recentQuery.dataUpdatedAt],
    enabled: ready,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<readonly ChannelRow[]> => {
      const api = window.testcard.channels;
      if (searching) return api.search(debounced, sourceId ?? undefined);
      if (shown === "favourites") return own(await api.favourites());
      if (shown === "recent") return own(await api.recent());
      if (shown === "all") return api.browse({ limit: CHANNELS_MOST, ...(sourceId !== null ? { sourceId } : {}) });
      if (shown.startsWith("all:")) return api.browse({ limit: CHANNELS_MOST, sourceId: shown.slice(4) });
      return api.browse({ limit: CHANNELS_MOST, categoryId: shown, ...(sourceId !== null ? { sourceId } : {}) });
    },
  });
  const rows = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);
  useEffect(() => onListChange(rows), [rows, onListChange]);

  // ---- the window ----
  const [offsetMin, setOffsetMin] = useState(0);
  const earliest = floorToSlot(nowMs);
  const from = earliest + offsetMin * 60_000;
  const to = from + WINDOW_MIN * 60_000;
  useEffect(() => setOffsetMin(0), [shown, sourceId]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(720);
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setTrackWidth(element.clientWidth));
    observer.observe(element);
    setTrackWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const pxPerMin = trackWidth / WINDOW_MIN;

  // ---- listings for the rows on screen and a lookahead, in blocks so scrolling does not refetch on every row ----
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const read = () => setScroll({ top: element.scrollTop, height: element.clientHeight });
    read();
    element.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, []);
  const firstRow = Math.max(0, Math.floor(scroll.top / ROW_H) - 4);
  const lastRow = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + 4);
  const blockFrom = Math.max(0, Math.floor(firstRow / BLOCK) * BLOCK - BLOCK);
  const blockTo = Math.min(rows.length, Math.ceil(lastRow / BLOCK) * BLOCK + BLOCK);
  const wantedIds = useMemo(() => rows.slice(blockFrom, blockTo).map((c) => c.id), [rows, blockFrom, blockTo]);
  const listingsQuery = useQuery({
    queryKey: ["epg", "window", wantedIds, from, to],
    queryFn: () => window.testcard.epg.window(wantedIds, from, to),
    enabled: wantedIds.length > 0,
    placeholderData: (prev) => prev,
  });
  // Rows the imported guide has nothing for ask an Xtream provider what is on, a few at a time, once each.
  const askedProvider = useRef(new Set<string>());
  const [providerListings, setProviderListings] = useState<ReadonlyMap<string, readonly ProgrammeLite[]>>(new Map());
  const missingIds = useMemo(() => {
    if (listingsQuery.data === undefined || listingsQuery.isPlaceholderData) return [];
    const have = new Set(listingsQuery.data.map((p) => p.channelId));
    return rows.slice(firstRow, lastRow).map((c) => c.id).filter((id) => !have.has(id) && !askedProvider.current.has(id)).slice(0, 12);
  }, [listingsQuery.data, listingsQuery.isPlaceholderData, rows, firstRow, lastRow]);
  useEffect(() => {
    if (missingIds.length === 0) return;
    for (const id of missingIds) askedProvider.current.add(id);
    void window.testcard.epg.providerListings(missingIds).then((found) =>
      setProviderListings((prev) => {
        const next = new Map(prev);
        for (const id of missingIds) next.set(id, found.filter((p) => p.channelId === id));
        return next;
      }),
    ).catch(() => undefined);
  }, [missingIds]);
  const loadedIds = useMemo(() => new Set(wantedIds), [wantedIds]);
  const listings = useMemo(() => {
    const map = new Map<string, Listing[]>();
    const all = [...(listingsQuery.data ?? []), ...[...providerListings.values()].flat()];
    for (const p of all as readonly ProgrammeLite[]) {
      const entry: Listing = { title: p.title, start: p.startMs, end: p.endMs, ...(p.description !== undefined ? { description: p.description } : {}) };
      const list = map.get(p.channelId);
      if (list) list.push(entry);
      else map.set(p.channelId, [entry]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [listingsQuery.data, providerListings]);
  const segmentsOf = useCallback(
    (channelId: string) => segmentsFor(loadedIds.has(channelId) ? (listings.get(channelId) ?? []) : null, from, to),
    [listings, loadedIds, from, to],
  );

  // ---- selection ----
  const [sel, setSel] = useState<{ channelId: string; at: number } | null>(null);
  const selRow = useMemo(() => {
    if (rows.length === 0) return -1;
    const i = sel === null ? -1 : rows.findIndex((c) => c.id === sel.channelId);
    return i === -1 ? 0 : i;
  }, [rows, sel]);
  const selChannel = rows[selRow];
  const selAt = Math.min(Math.max(sel?.at ?? nowMs, from), to - 1);
  const selSegments = useMemo(() => (selChannel ? segmentsOf(selChannel.id) : []), [selChannel, segmentsOf]);
  const selIndex = selSegments.findIndex((s) => s.start <= selAt && selAt < s.end);
  const selSegment = selSegments[selIndex];
  const selListing = selSegment?.airing as Listing | null | undefined;
  const nextListing = selSegments.slice(selIndex + 1).find((s) => s.airing !== null)?.airing as Listing | undefined;

  const pick = (channelId: string, at: number) => setSel({ channelId, at });
  const gridRef = useRef<HTMLDivElement>(null);
  const revealRow = (index: number) => {
    const element = bodyRef.current;
    if (!element) return;
    const top = index * ROW_H;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_H > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_H - element.clientHeight;
  };
  const page = (delta: number) => setOffsetMin((o) => Math.max(0, o + delta));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!selChannel) return;
    const move = (index: number) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, index))];
      if (next) {
        pick(next.id, selAt);
        revealRow(rows.indexOf(next));
      }
    };
    switch (event.key) {
      case "ArrowDown": move(selRow + 1); break;
      case "ArrowUp": move(selRow - 1); break;
      case "PageDown": move(selRow + 8); break;
      case "PageUp": move(selRow - 8); break;
      case "ArrowRight":
        if (selSegment && selSegment.end < to) pick(selChannel.id, selSegment.end);
        else { page(PAGE_MIN); pick(selChannel.id, selAt + PAGE_MIN * 60_000); }
        break;
      case "ArrowLeft":
        if (selSegment && selSegment.start > from) pick(selChannel.id, selSegment.start - 1);
        else if (offsetMin > 0) { page(-PAGE_MIN); pick(selChannel.id, selAt - PAGE_MIN * 60_000); }
        break;
      case "Enter": onPlay(selChannel); break;
      default: return;
    }
    event.preventDefault();
  };

  // ---- the preview: the selected channel plays muted in the header frame once the pick has rested ----
  const selChannelId = selChannel?.id;
  useEffect(() => {
    if (selChannelId === undefined || inPlayer) return;
    const id = setTimeout(() => void window.testcard.playback.preview(selChannelId).catch(() => undefined), TUNE_DELAY_MS);
    return () => clearTimeout(id);
  }, [selChannelId, inPlayer]);
  // Leaving the page ends the preview (and only a preview). Entering the full-screen player does not unmount it.
  useEffect(() => () => void window.testcard?.playback.stopPreview(), []);

  // ---- options for a channel ----
  const [menu, setMenu] = useState<{ x: number; y: number; channel: ChannelRow } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);
  const changed = () => void queryClient.invalidateQueries({ queryKey: ["channels"] });
  const favourite = useMutation({ mutationFn: (id: string) => window.testcard.channels.toggleFavourite(id), onSuccess: changed });
  const forget = useMutation({ mutationFn: (id: string) => window.testcard.channels.removeFromHistory(id), onSuccess: changed });

  const nowLeft = ((nowMs - from) / 60_000) * pxPerMin;
  const slots = Array.from({ length: WINDOW_MIN / SLOT_MIN }, (_, i) => from + i * SLOT_MIN * 60_000);
  const noGuide = rows.length > 0 && !listingsQuery.isFetching && (listingsQuery.data?.length ?? 0) === 0;

  return (
    <main className="lt">
      <aside className="lt-rail" aria-label="Lists">
        <div className="pw-search">
          <Icon name="search" size={15} />
          <input type="search" placeholder="Search channels" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search channels" />
        </div>
        <div className="lt-rail-scroll">
          {lists.map((list: RailList, i) => (
            <div key={list.id}>
              {list.section !== undefined && list.section !== lists[i - 1]?.section && <p className="pw-nav-group">{list.section}</p>}
              <button
                type="button"
                className="pw-cat"
                data-active={!searching && shown === list.id}
                disabled={list.count === 0 && (list.id === "favourites" || list.id === "recent")}
                onClick={() => { setTerm(""); setPicked(list.id); }}
                title={list.label}
              >
                <span className="pw-cat-name">{list.label}</span>
                <span className="pw-cat-count">{list.count}</span>
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="lt-main">
        <header className="lt-head">
          <div className="lt-preview" onDoubleClick={() => selChannel && onPlay(selChannel)} title="Double-click to watch full screen">
            {!inPlayer && <PictureWell />}
            {selChannel?.logo_url && <img className="lt-preview-logo" src={logoSrc(selChannel.logo_url)} alt="" referrerPolicy="no-referrer" />}
          </div>
          <div className="lt-info">
            <p className="lt-info-list">{shownLabel}</p>
            <h2 className="lt-info-channel">{selChannel?.normalised_name ?? (channelsQuery.isLoading ? "" : "No channels")}</h2>
            {selListing ? (
              <>
                <p className="lt-info-now">{selListing.title}</p>
                <p className="lt-info-time tnum">{formatClock(selListing.start)} to {formatClock(selListing.end)}</p>
                {selListing.description && <p className="lt-info-desc">{selListing.description}</p>}
              </>
            ) : (
              selChannel && <p className="lt-info-time">{noGuide ? "No guide data for these channels." : "No listing for this time."}</p>
            )}
            {nextListing && <p className="lt-info-next tnum">Next: {formatClock(nextListing.start)} {nextListing.title}</p>}
            {selChannel && (
              <div className="lt-info-actions">
                <button type="button" className="btn btn--primary" onClick={() => onPlay(selChannel)}>Watch</button>
                <button type="button" className="btn" onClick={() => favourite.mutate(selChannel.id)}>
                  {selChannel.is_favourite ? "Remove from Favourites" : "Add to Favourites"}
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="lt-grid" ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} role="grid" aria-label="Guide">
          <div className="pw-guide-ruler">
            <span className="pw-guide-ruler-pad lt-pager">
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Earlier" disabled={offsetMin === 0} onClick={() => page(-PAGE_MIN)}>‹</button>
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Later" onClick={() => page(PAGE_MIN)}>›</button>
              {offsetMin !== 0 && <button type="button" className="btn btn--ghost" onClick={() => setOffsetMin(0)}>Now</button>}
            </span>
            <div className="pw-guide-ruler-track lt-track" ref={trackRef}>
              {slots.map((ms) => (
                <span key={ms} className="pw-guide-tick tnum" style={{ left: ((ms - from) / 60_000) * pxPerMin }}>{formatClock(ms)}</span>
              ))}
            </div>
          </div>
          <div className="lt-body" ref={bodyRef}>
            <div className="lt-rows" style={{ height: rows.length * ROW_H }}>
              {rows.slice(firstRow, lastRow).map((channel, k) => {
                const index = firstRow + k;
                return (
                  <div className="pw-guide-row lt-row" key={channel.id} style={{ top: index * ROW_H }} data-active={channel.id === activeChannelId} data-selected={index === selRow}>
                    <button
                      type="button"
                      className="pw-guide-ch"
                      tabIndex={-1}
                      title={channel.raw_name}
                      onClick={() => { pick(channel.id, nowMs); gridRef.current?.focus(); }}
                      onDoubleClick={() => onPlay(channel)}
                      onContextMenu={(e) => { e.preventDefault(); pick(channel.id, nowMs); setMenu({ x: e.clientX, y: e.clientY, channel }); }}
                    >
                      {channel.logo_url ? <img className="lt-ch-logo" src={logoSrc(channel.logo_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                      <span className="pw-guide-ch-name">{channel.normalised_name}</span>
                      {channel.is_favourite ? <Icon name="star" size={12} filled /> : null}
                    </button>
                    <div className="lt-cells">
                      {segmentsOf(channel.id).map((segment) => {
                        const left = ((segment.start - from) / 60_000) * pxPerMin;
                        const width = ((segment.end - segment.start) / 60_000) * pxPerMin;
                        const selected = index === selRow && segment.start <= selAt && selAt < segment.end;
                        return (
                          <button
                            key={segment.start}
                            type="button"
                            tabIndex={-1}
                            className="pw-guide-prog lt-cell"
                            style={{ left, width: Math.max(2, width - 2) }}
                            data-gap={segment.airing === null}
                            data-live={segment.start <= nowMs && nowMs < segment.end}
                            data-selected={selected}
                            title={segment.airing ? `${formatClock(segment.start)} to ${formatClock(segment.end)}  ${segment.airing.title}` : undefined}
                            onClick={() => { pick(channel.id, Math.max(segment.start, from)); gridRef.current?.focus(); }}
                            onDoubleClick={() => onPlay(channel)}
                            onContextMenu={(e) => { e.preventDefault(); pick(channel.id, segment.start); setMenu({ x: e.clientX, y: e.clientY, channel }); }}
                          >
                            <span className="pw-guide-prog-name">{segment.airing?.title ?? ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {rows.length > 0 && nowLeft >= 0 && nowLeft <= trackWidth && (
                <div className="pw-guide-now lt-now" style={{ left: `calc(var(--guide-gutter) + ${nowLeft}px)`, top: 0 }} />
              )}
            </div>
          </div>
          {rows.length === 0 && channelsQuery.isSuccess && (
            <p className="pw-empty">
              {searching ? `Nothing matches “${debounced}”.` : shown === "favourites" ? "No favourites yet. Right-click a channel to add one." : shown === "recent" ? "Nothing played yet." : "No channels. Add a source and refresh it."}
            </p>
          )}
        </div>
      </section>

      {menu && (
        <div className="lt-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 140) }} role="menu">
          <button type="button" role="menuitem" onClick={() => onPlay(menu.channel)}>Watch</button>
          <button type="button" role="menuitem" onClick={() => favourite.mutate(menu.channel.id)}>
            {menu.channel.is_favourite ? "Remove from Favourites" : "Add to Favourites"}
          </button>
          {shown === "recent" && <button type="button" role="menuitem" onClick={() => forget.mutate(menu.channel.id)}>Remove from Recently watched</button>}
        </div>
      )}
    </main>
  );
}
