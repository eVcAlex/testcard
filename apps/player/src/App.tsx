import { useEffect, useMemo, useState } from "preact/hooks";
import { categories, episodesOf, films, forgetCatalogue, liveChannels, shows, type Part, type Show } from "./catalogue.ts";
import { feedsFor, type WebChannel } from "./feeds.ts";
import { Player, type PlayRequest } from "./Player.tsx";
import { plainReason, signInAndLoad, signOut, type WebSource } from "./session.ts";
import type { Category } from "./xtream.ts";

type Tab = "live" | "movies" | "series";
const SHOW_AT_FIRST = 200;

/** Runs a loader whenever its inputs change, with the loading and failure states a list needs. */
function useLoad<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: load !== null });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (load === null) return setState({ loading: false });
    let stale = false;
    setState({ loading: true });
    load().then(
      (value) => !stale && setState({ value, loading: false }),
      (reason) => !stale && setState({ error: plainReason(reason), loading: false }),
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, again]);
  return { ...state, retry: () => setAgain((n) => n + 1) };
}

export function App() {
  const [sources, setSources] = useState<WebSource[]>();
  const [play, setPlay] = useState<PlayRequest>();
  if (sources === undefined) return <SignIn onSignedIn={setSources} />;
  return (
    <>
      <Browser
        sources={sources}
        onPlay={setPlay}
        onSignOut={() => {
          void signOut();
          forgetCatalogue();
          setSources(undefined);
        }}
      />
      {play !== undefined ? <Player request={play} onClose={() => setPlay(undefined)} /> : null}
    </>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (sources: WebSource[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    setError(undefined);
    try {
      const sources = await signInAndLoad(String(form.get("email")).trim(), String(form.get("password")));
      if (sources.length === 0) setError("This account has no sources yet. Add one in the app first.");
      else onSignedIn(sources);
    } catch (reason) {
      setError(plainReason(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="signin">
      <h1>Testcard</h1>
      <p>Sign in with your Testcard account to watch in the browser. Your sources open here, on this device, with your password.</p>
      <form onSubmit={submit}>
        <label>Email<input name="email" type="email" autocomplete="username" required disabled={busy} /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required disabled={busy} /></label>
        <button type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        {error !== undefined ? <p class="problem" role="alert">{error}</p> : null}
      </form>
      <p class="small">Video from your provider is relayed through Testcard's servers so the browser can play it. Nothing is stored in this browser.</p>
    </main>
  );
}

function Browser({ sources, onPlay, onSignOut }: { sources: WebSource[]; onPlay: (request: PlayRequest) => void; onSignOut: () => void }) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("live");
  const [category, setCategory] = useState<string>();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>();
  const source = sources.find((candidate) => candidate.id === sourceId) ?? (sources[0] as WebSource);
  const searching = query.trim().length >= 2;

  const cats = useLoad(() => categories(source, tab), [source.id, tab]);
  // A category is chosen once the list is in; search looks across the whole source instead.
  useEffect(() => {
    setCategory(undefined);
    setShow(undefined);
  }, [source.id, tab]);
  useEffect(() => {
    if (category === undefined && cats.value !== undefined && cats.value[0] !== undefined) setCategory(cats.value[0].id);
  }, [cats.value, category]);

  const scope = searching ? undefined : category;
  const ready = searching || category !== undefined;
  const live = useLoad(tab === "live" && ready ? () => liveChannels(source, scope) : null, [source.id, tab, scope, ready]);
  const filmList = useLoad(tab === "movies" && ready ? () => films(source, scope) : null, [source.id, tab, scope, ready]);
  const showList = useLoad(tab === "series" && ready ? () => shows(source, scope) : null, [source.id, tab, scope, ready]);
  const match = (name: string) => !searching || name.toLowerCase().includes(query.trim().toLowerCase());

  const playChannel = (channel: WebChannel) => {
    // Another way to play it is found among the channels of the source once they are in; the first play does not wait.
    const start = (pool: readonly WebChannel[]) => {
      const feeds = feedsFor(channel, pool).map((feed) => ({ name: feed.name, urls: feed.urls }));
      onPlay({ title: channel.name, live: true, feeds });
    };
    const loaded = live.value ?? [];
    if (searching) return start(loaded);
    start(loaded);
    void liveChannels(source).catch(() => undefined);
  };

  return (
    <div class="browser">
      <header>
        <strong>Testcard</strong>
        {sources.length > 1 ? (
          <select value={source.id} onChange={(event) => setSourceId((event.currentTarget as HTMLSelectElement).value)} aria-label="Source">
            {sources.map((candidate) => <option value={candidate.id}>{candidate.label}</option>)}
          </select>
        ) : <span class="muted">{source.label}</span>}
        <button class="quiet" onClick={onSignOut}>Sign out</button>
      </header>
      <nav class="tabs">
        {(["live", "movies", "series"] as const).map((name) => (
          <button class={tab === name ? "on" : ""} onClick={() => { setTab(name); setQuery(""); }}>{name === "live" ? "Live TV" : name === "movies" ? "Movies" : "Series"}</button>
        ))}
        <input type="search" placeholder="Search (2+ letters)" value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
      </nav>
      {!searching ? <CategoryChips state={cats} selected={category} onPick={(id) => { setCategory(id); setShow(undefined); }} /> : null}
      <main>
        {tab === "live" ? (
          <List state={live} empty="No channels here." render={(channels) => <ChannelList channels={channels.filter((c) => match(c.name))} onPlay={playChannel} />} />
        ) : tab === "movies" ? (
          <List state={filmList} empty="No films here." render={(items) => <Grid items={items.filter((f) => match(f.name)).map((f) => ({ key: f.id, name: f.name, image: f.poster, onPick: () => onPlay({ title: f.name, live: false, feeds: [{ name: f.name, urls: [f.url] }], resumeKey: `${source.id}:m:${f.id}` }) }))} />} />
        ) : show !== undefined ? (
          <Episodes source={source} show={show} onBack={() => setShow(undefined)} onPlay={onPlay} />
        ) : (
          <List state={showList} empty={source.kind === "m3u" ? "Series from playlists are in the apps." : "No series here."} render={(items) => <Grid items={items.filter((s) => match(s.name)).map((s) => ({ key: s.id, name: s.name, image: s.cover, onPick: () => setShow(s) }))} />} />
        )}
      </main>
    </div>
  );
}

function CategoryChips({ state, selected, onPick }: { state: { value?: Category[]; error?: string; loading: boolean; retry: () => void }; selected: string | undefined; onPick: (id: string) => void }) {
  if (state.error !== undefined) return <p class="problem">{state.error} <button class="quiet" onClick={state.retry}>Try again</button></p>;
  return (
    <div class="chips" role="tablist">
      {state.loading ? <span class="muted">Loading...</span> : null}
      {(state.value ?? []).map((c) => <button class={c.id === selected ? "on" : ""} onClick={() => onPick(c.id)}>{c.name}</button>)}
    </div>
  );
}

function List<T>({ state, render, empty }: { state: { value?: T[]; error?: string; loading: boolean; retry: () => void }; render: (items: T[]) => preact.ComponentChildren; empty: string }) {
  if (state.loading) return <p class="muted pad">Loading from your provider. The first time can take a while...</p>;
  if (state.error !== undefined) return <p class="problem pad">{state.error} <button class="quiet" onClick={state.retry}>Try again</button></p>;
  if (state.value === undefined || state.value.length === 0) return <p class="muted pad">{empty}</p>;
  return <>{render(state.value)}</>;
}

function ChannelList({ channels, onPlay }: { channels: WebChannel[]; onPlay: (channel: WebChannel) => void }) {
  const [more, setMore] = useState(SHOW_AT_FIRST);
  useEffect(() => setMore(SHOW_AT_FIRST), [channels]);
  return (
    <ul class="channels">
      {channels.slice(0, more).map((channel) => (
        <li><button onClick={() => onPlay(channel)}>{channel.logo !== undefined ? <img src={`/watch/p?u=${encodeURIComponent(channel.logo)}`} alt="" loading="lazy" width="40" height="40" onError={(event) => ((event.currentTarget as HTMLImageElement).style.visibility = "hidden")} /> : <span class="logo" />}<span>{channel.name}</span></button></li>
      ))}
      {channels.length > more ? <li><button class="quiet" onClick={() => setMore(more + SHOW_AT_FIRST)}>Show more ({channels.length - more})</button></li> : null}
    </ul>
  );
}

function Grid({ items }: { items: { key: string; name: string; image: string | undefined; onPick: () => void }[] }) {
  const [more, setMore] = useState(SHOW_AT_FIRST);
  useEffect(() => setMore(SHOW_AT_FIRST), [items.length]);
  return (
    <>
      <ul class="grid">
        {items.slice(0, more).map((item) => (
          <li><button onClick={item.onPick}>{item.image !== undefined ? <img src={`/watch/p?u=${encodeURIComponent(item.image)}`} alt="" loading="lazy" onError={(event) => ((event.currentTarget as HTMLImageElement).style.visibility = "hidden")} /> : <span class="poster" />}<span>{item.name}</span></button></li>
        ))}
      </ul>
      {items.length > more ? <p class="pad"><button class="quiet" onClick={() => setMore(more + SHOW_AT_FIRST)}>Show more ({items.length - more})</button></p> : null}
    </>
  );
}

function Episodes({ source, show, onBack, onPlay }: { source: WebSource; show: Show; onBack: () => void; onPlay: (request: PlayRequest) => void }) {
  const state = useLoad(() => episodesOf(source, show), [source.id, show.id]);
  const bySeason = useMemo(() => {
    const groups = new Map<number, Part[]>();
    for (const part of state.value ?? []) groups.set(part.season, [...(groups.get(part.season) ?? []), part]);
    return [...groups.entries()];
  }, [state.value]);
  return (
    <div class="pad">
      <button class="quiet" onClick={onBack}>Back</button>
      <h2>{show.name}</h2>
      {show.plot !== undefined ? <p class="muted">{show.plot}</p> : null}
      <List state={state} empty="No episodes." render={() => (
        <>{bySeason.map(([season, parts]) => (
          <section><h3>Season {season}</h3>
            <ul class="episodes">{parts.map((part) => <li><button onClick={() => onPlay({ title: `${show.name} S${season}E${part.number}`, live: false, feeds: [{ name: part.title, urls: [part.url] }], resumeKey: `${source.id}:e:${part.id}` })}>{part.number}. {part.title}</button></li>)}</ul>
          </section>
        ))}</>
      )} />
    </div>
  );
}
