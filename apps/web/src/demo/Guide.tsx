import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import "./demo.css";
import { CATEGORIES, CHANNELS, COLLAPSED_ROWS, SOURCES, categoryLabel, channelById } from "./data.ts";
import { ChannelList } from "./ChannelList.tsx";
import { Preview } from "./Preview.tsx";
import { categoryCount, displayName, emptyMessage, fmtTime, nowNext, visibleChannels } from "./state.ts";
import type { DemoAction, DemoState } from "./state.ts";

export const LIST_ID = "dm-list";
export const SEARCH_ID = "dm-q";
const LABEL_ID = "dm-label";

export interface GuideProps {
  state: DemoState;
  /** Absent on the server-rendered copy: the same markup, nothing wired. */
  dispatch?: (action: DemoAction) => void;
  expanded: boolean;
  onExpand?: () => void;
  rootRef?: Ref<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** The live canvas, laid over the CSS test pattern. */
  canvas?: ReactNode;
}

const StarIcon = () => (
  <svg className="dm-star" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" strokeLinejoin="round" /></svg>
);

/**
 * The guide as a view of DemoState. The server renders it from the initial state (a usable now/next list without
 * JavaScript); the interactive Demo renders the same thing with handlers. Nothing here reads the time or a random number.
 */
export function Guide({ state, dispatch, expanded, onExpand, rootRef, onKeyDown, canvas }: GuideProps) {
  const send = dispatch;
  const visible = visibleChannels(state);
  const empty = visible.length === 0;
  const playing = channelById(state.playing);
  const { now } = nowNext(playing, state.clock);
  const isFav = state.favs.includes(playing.id);
  const tabStop = state.category;

  return (
    <div className="demo" data-mode={state.mode} ref={rootRef} onKeyDown={onKeyDown}>
      <div className="dm">
        <div className="dm-top">
          <p className="dm-label" id={LABEL_ID}>Demo · invented channels, no real streams</p>
          <span className="dm-clock tnum" title="A fixed demo clock, not your time">Demo clock <b>{fmtTime(state.clock)}</b></span>
          <button type="button" className="dm-btn" aria-pressed={state.showRawNames} onClick={send && (() => send({ type: "setRaw", value: !state.showRawNames }))}>Raw names</button>
          <button type="button" className="dm-btn dm-tvbtn" aria-pressed={state.mode === "tv"} onClick={send && (() => send({ type: "toggleTv" }))}>TV mode <kbd>T</kbd></button>
        </div>

        <div className="dm-pvrow">
          <Preview channel={playing} showRaw={state.showRawNames}>{canvas}</Preview>
          <div className="dm-info">
            <span className="dm-k"><span className="dm-dot" aria-hidden="true" />Live</span>
            <span className="dm-iname">{displayName(playing, state.showRawNames)}</span>
            <span className="dm-ititle">{now.title}</span>
            <span className="dm-imeta tnum">{fmtTime(now.start)}–{fmtTime(now.end)} · {categoryLabel(playing.category)}</span>
            <button type="button" className="dm-btn" aria-pressed={isFav} onClick={send && (() => send({ type: "toggleFavourite", channelId: playing.id }))}>
              <StarIcon />Favourite <kbd>F</kbd>
            </button>
          </div>
        </div>

        <div className="dm-search">
          <label className="sr-only" htmlFor={SEARCH_ID}>Search channels</label>
          <input
            id={SEARCH_ID}
            type="search"
            placeholder="Search channels  ( / )"
            autoComplete="off"
            spellCheck={false}
            value={state.query}
            onChange={(e) => send?.({ type: "setQuery", query: e.target.value })}
          />
        </div>

        <div className="dm-tabs" role="tablist" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`dm-tab-${c.id}`}
              data-k={c.id}
              className="dm-tab"
              aria-selected={state.category === c.id}
              aria-controls={LIST_ID}
              tabIndex={tabStop === c.id ? 0 : -1}
              onClick={send && (() => send({ type: "setCategory", category: c.id }))}
            >
              <span>{c.label}</span><span className="dm-n tnum">{categoryCount(state, c.id)}</span>
            </button>
          ))}
        </div>

        <div className="dm-list">
          <ChannelList
            id={LIST_ID}
            channels={visible}
            clock={state.clock}
            favs={state.favs}
            playing={state.playing}
            focus={state.focus}
            showRaw={state.showRawNames}
            collapsed={!expanded && visible.length > COLLAPSED_ROWS}
            hidden={empty}
            onPlay={send && ((id) => send({ type: "play", channelId: id }))}
          />
          {empty && (
            <div className="dm-empty">
              <span className="dm-bars" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>
              <p>{emptyMessage(state)}</p>
            </div>
          )}
          {!expanded && visible.length > COLLAPSED_ROWS && (
            <button type="button" className="dm-more" onClick={onExpand}>{`Show all channels (${visible.length})`}</button>
          )}
        </div>

        <ul className="dm-legend" aria-label="Keyboard shortcuts">
          <li><kbd>↑</kbd> <kbd>↓</kbd> channel</li>
          <li><kbd>←</kbd> <kbd>→</kbd> programme</li>
          <li><kbd>Enter</kbd> play</li>
          <li><kbd>F</kbd> favourite</li>
          <li><kbd>/</kbd> search</li>
          <li><kbd>Esc</kbd> clear</li>
          <li><kbd>T</kbd> TV mode</li>
        </ul>

        <div className="dm-src">
          <p className="dm-srch">Sources</p>
          <ul>
            {SOURCES.map((s) => (
              <li key={s.id}>{s.name}<span>{s.kind} · {CHANNELS.filter((c) => c.source === s.id).length} channels</span></li>
            ))}
          </ul>
        </div>

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" id="dm-live">{state.announce}</p>
      </div>
    </div>
  );
}
