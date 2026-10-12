import { useEffect, useMemo, useState } from "preact/hooks";
import { categories, episodesOf, films, forgetCatalogue, liveChannels, shows, type Film, type Part, type Show } from "./catalogue.ts";
import { feedsFor, type WebChannel } from "./feeds.ts";
import type { Library, Shelf } from "./library.ts";
import { Player, type PlayRequest } from "./Player.tsx";
import { PROFILE_COLOURS, pinMatches, type WebProfile } from "./profiles.ts";
import { plainReason, signInAndLoad, signOut, type Account, type WebSource } from "./session.ts";
import { shortEpg, type Category } from "./xtream.ts";

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

/** Redraws when the library changes (a heart, a place kept). */
function useLibrary(library: Library): void {
  const [, bump] = useState(0);
  useEffect(() => library.subscribe(() => bump((n) => n + 1)), [library]);
}

export function App() {
  const [account, setAccount] = useState<Account>();
  const [profile, setProfile] = useState<WebProfile>();
  const [library, setLibrary] = useState<Library>();
  const [play, setPlay] = useState<PlayRequest>();

  // What is waiting to be saved goes out when the page is left or hidden.
  useEffect(() => {
    const flush = () => void library?.send();
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      removeEventListener("pagehide", flush);
    };
  }, [library]);

  const leave = () => {
    void library?.send();
    void signOut();
    forgetCatalogue();
    setPlay(undefined);
    setLibrary(undefined);
    setProfile(undefined);
    setAccount(undefined);
  };
  const choose = async (picked: WebProfile) => {
    if (account === undefined) return;
    setLibrary(await account.openLibrary(picked.id));
    setProfile(picked);
  };
  const switchProfile = () => {
    void library?.send();
    setPlay(undefined);
    setLibrary(undefined);
    setProfile(undefined);
  };

  if (account === undefined) return <SignIn onSignedIn={(opened) => {
    setAccount(opened);
    // One profile is the account itself: no need to ask who is watching.
    const only = opened.profiles.length === 1 ? opened.profiles[0] : undefined;
    if (only !== undefined && only.pin === null) void opened.openLibrary(only.id).then((opened_) => { setLibrary(opened_); setProfile(only); });
  }} />;
  if (profile === undefined || library === undefined) return <Profiles profiles={account.profiles} onPick={choose} onSignOut={leave} />;
  return (
    <>
      <Browser
        sources={account.sources}
        library={library}
        profile={account.profiles.length > 1 ? profile : undefined}
        onPlay={setPlay}
        onSwitchProfile={switchProfile}
        onSignOut={leave}
      />
      {play !== undefined ? <Player request={play} onClose={() => { setPlay(undefined); void library.send(); }} /> : null}
    </>
  );
}

/** Who is watching. A profile with a PIN asks for it, the one set in the apps. */
function Profiles({ profiles, onPick, onSignOut }: { profiles: WebProfile[]; onPick: (profile: WebProfile) => Promise<void>; onSignOut: () => void }) {
  const [asking, setAsking] = useState<WebProfile>();
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = async (profile: WebProfile) => {
    setBusy(true);
    try {
      await onPick(profile);
    } finally {
      setBusy(false);
    }
  };
  if (asking !== undefined) {
    return (
      <main class="signin">
        <h1>{asking.name}</h1>
        <form onSubmit={(event) => {
          event.preventDefault();
          const digits = String(new FormData(event.currentTarget as HTMLFormElement).get("pin"));
          if (pinMatches(asking, digits)) void open(asking);
          else setWrong(true);
        }}>
          <label>PIN<input name="pin" type="password" inputMode="numeric" autocomplete="off" autofocus required /></label>
          <button type="submit" disabled={busy}>Watch</button>
          <button type="button" class="quiet" onClick={() => { setAsking(undefined); setWrong(false); }}>Back</button>
          {wrong ? <p class="problem" role="alert">That PIN is not right.</p> : null}
        </form>
      </main>
    );
  }
  return (
    <main class="signin">
      <h1>Who is watching?</h1>
      <ul class="profiles">
        {profiles.map((profile) => (
          <li><button disabled={busy} onClick={() => (profile.pin !== null ? setAsking(profile) : void open(profile))}>
            <span class="avatar" style={{ background: PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.length] }}>{profile.name.slice(0, 1).toUpperCase()}</span>
            <span>{profile.name}{profile.pin !== null ? " 🔒" : ""}</span>
          </button></li>
        ))}
      </ul>
      <button class="quiet" onClick={onSignOut}>Sign out</button>
    </main>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    setError(undefined);
    try {
      const opened = await signInAndLoad(String(form.get("email")).trim(), String(form.get("password")));
      if (opened.sources.length === 0) setError("This account has no sources yet. Add one in the app first.");
      else onSignedIn(opened);
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
      <p class="small">Video from your provider is relayed through Testcard's servers so the browser can play it. Favourites and your place in films sync with the apps; nothing else is stored in this browser.</p>
    </main>
  );
}

const FAVOURITES = "__fav";
const RECENT = "__recent";
const SHELVES = {
  live: { fav: "channelFavs", recent: "channelRecents" },
  movies: { fav: "movieFavs", recent: "movieRecents" },
  series: { fav: "seriesFavs", recent: "seriesRecents" },
} as const satisfies Record<Tab, { fav: Shelf; recent: Shelf }>;

/** Items in the order a shelf keeps its keys (newest first, or the viewer's own order); those not in the list are left out. */
function onShelf<T>(items: readonly T[], keyOf: (item: T) => string | undefined, keys: readonly string[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined && key !== "") byKey.set(key, item);
  }
  return keys.flatMap((key) => (byKey.has(key) ? [byKey.get(key) as T] : []));
}

function Browser({ sources, library, profile, onPlay, onSwitchProfile, onSignOut }: { sources: WebSource[]; library: Library; profile: WebProfile | undefined; onPlay: (request: PlayRequest) => void; onSwitchProfile: () => void; onSignOut: () => void }) {
  useLibrary(library);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("live");
  const [category, setCategory] = useState<string>();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>();
  const source = sources.find((candidate) => candidate.id === sourceId) ?? (sources[0] as WebSource);
  const searching = query.trim().length >= 2;
  const shelf = SHELVES[tab];
  // A playlist's channels have no stable id, so they cannot be favourites.
  const hasShelves = !(tab === "live" && source.kind === "m3u");

  const cats = useLoad(() => categories(source, tab), [source.id, tab]);
  const chips = useMemo(
    () => [...(hasShelves ? [{ id: FAVOURITES, name: "★ Favourites" }, { id: RECENT, name: "Recent" }] : []), ...(cats.value ?? [])],
    [cats.value, hasShelves],
  );
  // A category is chosen once the list is in; search looks across the whole source instead.
  useEffect(() => {
    setCategory(undefined);
    setShow(undefined);
  }, [source.id, tab]);
  useEffect(() => {
    if (category === undefined && cats.value !== undefined && cats.value[0] !== undefined) setCategory(cats.value[0].id);
  }, [cats.value, category]);

  const special = category === FAVOURITES || category === RECENT;
  const scope = searching || special ? undefined : category;
  const ready = searching || category !== undefined;
  const live = useLoad(tab === "live" && ready ? () => liveChannels(source, scope) : null, [source.id, tab, scope, ready]);
  const filmList = useLoad(tab === "movies" && ready ? () => films(source, scope) : null, [source.id, tab, scope, ready]);
  const showList = useLoad(tab === "series" && ready ? () => shows(source, scope) : null, [source.id, tab, scope, ready]);
  const match = (name: string) => !searching || name.toLowerCase().includes(query.trim().toLowerCase());
  const shown = <T,>(items: T[], keyOf: (item: T) => string | undefined, nameOf: (item: T) => string): T[] =>
    searching ? items.filter((item) => match(nameOf(item))) : special ? onShelf(items, keyOf, library.keys(category === FAVOURITES ? shelf.fav : shelf.recent)) : items;

  const playChannel = (channel: WebChannel) => {
    // Another way to play it is found among the channels of the source once they are in; the first play does not wait.
    const feeds = feedsFor(channel, live.value ?? []).map((feed) => ({ name: feed.name, urls: feed.urls }));
    onPlay({
      title: channel.name,
      live: true,
      feeds,
      ...(source.kind === "xtream" ? { guide: () => shortEpg(source.login, channel.id) } : {}),
      onStart: () => channel.libKey !== undefined && library.played("channelRecents", channel.libKey),
    });
    void liveChannels(source).catch(() => undefined);
  };
  const playFilm = (film: Film) => {
    const place = library.placeOf(film.key);
    onPlay({
      title: film.name,
      live: false,
      feeds: [{ name: film.name, urls: [film.url] }],
      ...(place !== undefined && !place.watched && place.position > 5 ? { resumeAt: place.position } : {}),
      onStart: () => library.played("movieRecents", film.key),
      onPlace: (position, duration) => library.keepPlace(film.key, "movie", position, duration),
    });
  };
  const playEpisode = (of: Show, part: Part) => {
    const place = library.placeOf(part.key);
    onPlay({
      title: `${of.name} S${part.season}E${part.number}`,
      live: false,
      feeds: [{ name: part.title, urls: [part.url] }],
      ...(place !== undefined && !place.watched && place.position > 5 ? { resumeAt: place.position } : {}),
      onStart: () => library.played("seriesRecents", of.key),
      onPlace: (position, duration) => library.keepPlace(part.key, "episode", position, duration),
    });
  };
  const fractionOf = (key: string): number | undefined => {
    const place = library.placeOf(key);
    if (place === undefined) return undefined;
    return place.watched ? 1 : place.duration !== null ? Math.min(1, place.position / place.duration) : undefined;
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
        {profile !== undefined ? <button class="quiet" onClick={onSwitchProfile}>{profile.name}</button> : null}
        <button class="quiet" onClick={onSignOut}>Sign out</button>
      </header>
      <nav class="tabs">
        {(["live", "movies", "series"] as const).map((name) => (
          <button class={tab === name ? "on" : ""} onClick={() => { setTab(name); setQuery(""); }}>{name === "live" ? "Live TV" : name === "movies" ? "Movies" : "Series"}</button>
        ))}
        <input type="search" placeholder="Search (2+ letters)" value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
      </nav>
      {!searching ? <CategoryChips state={cats} chips={chips} selected={category} onPick={(id) => { setCategory(id); setShow(undefined); }} /> : null}
      <main>
        {tab === "live" ? (
          <List state={live} empty={special ? "Nothing here yet. Tap the heart on a channel." : "No channels here."} render={(channels) => (
            <ChannelList channels={shown(channels, (c) => c.libKey, (c) => c.name)} library={library} onPlay={playChannel} />
          )} />
        ) : tab === "movies" ? (
          <List state={filmList} empty={special ? "Nothing here yet." : "No films here."} render={(items) => (
            <Grid items={shown(items, (f) => f.key, (f) => f.name).map((f) => ({ key: f.id, name: f.name, image: f.poster, onPick: () => playFilm(f), progress: fractionOf(f.key), fav: { on: library.has("movieFavs", f.key), toggle: () => library.toggleFavourite("movieFavs", f.key) } }))} />
          )} />
        ) : show !== undefined ? (
          <Episodes source={source} show={show} library={library} fractionOf={fractionOf} onBack={() => setShow(undefined)} onPlay={playEpisode} />
        ) : (
          <List state={showList} empty={special ? "Nothing here yet." : "No series here."} render={(items) => (
            <Grid items={shown(items, (s) => s.key, (s) => s.name).map((s) => ({ key: s.id, name: s.name, image: s.cover, onPick: () => setShow(s), fav: { on: library.has("seriesFavs", s.key), toggle: () => library.toggleFavourite("seriesFavs", s.key) } }))} />
          )} />
        )}
      </main>
    </div>
  );
}

function CategoryChips({ state, chips, selected, onPick }: { state: { value?: Category[]; error?: string; loading: boolean; retry: () => void }; chips: readonly Category[]; selected: string | undefined; onPick: (id: string) => void }) {
  if (state.error !== undefined) return <p class="problem">{state.error} <button class="quiet" onClick={state.retry}>Try again</button></p>;
  return (
    <div class="chips" role="tablist">
      {state.loading ? <span class="muted">Loading...</span> : null}
      {chips.map((c) => <button class={c.id === selected ? "on" : ""} onClick={() => onPick(c.id)}>{c.name}</button>)}
    </div>
  );
}

function List<T>({ state, render, empty }: { state: { value?: T[]; error?: string; loading: boolean; retry: () => void }; render: (items: T[]) => preact.ComponentChildren; empty: string }) {
  if (state.loading) return <p class="muted pad">Loading from your provider. The first time can take a while...</p>;
  if (state.error !== undefined) return <p class="problem pad">{state.error} <button class="quiet" onClick={state.retry}>Try again</button></p>;
  if (state.value === undefined) return <p class="muted pad">{empty}</p>;
  const out = render(state.value);
  return Array.isArray(out) && out.length === 0 ? <p class="muted pad">{empty}</p> : <>{out}</>;
}

function ChannelList({ channels, library, onPlay }: { channels: WebChannel[]; library: Library; onPlay: (channel: WebChannel) => void }) {
  const [more, setMore] = useState(SHOW_AT_FIRST);
  useEffect(() => setMore(SHOW_AT_FIRST), [channels.length]);
  if (channels.length === 0) return <p class="muted pad">No channels here.</p>;
  return (
    <ul class="channels">
      {channels.slice(0, more).map((channel) => (
        <li>
          <button class="main" onClick={() => onPlay(channel)}>{channel.logo !== undefined ? <img src={`/watch/p?u=${encodeURIComponent(channel.logo)}`} alt="" loading="lazy" width="40" height="40" onError={(event) => ((event.currentTarget as HTMLImageElement).style.visibility = "hidden")} /> : <span class="logo" />}<span>{channel.name}</span></button>
          {channel.libKey !== undefined ? <Heart on={library.has("channelFavs", channel.libKey)} toggle={() => library.toggleFavourite("channelFavs", channel.libKey as string)} name={channel.name} /> : null}
        </li>
      ))}
      {channels.length > more ? <li><button class="quiet" onClick={() => setMore(more + SHOW_AT_FIRST)}>Show more ({channels.length - more})</button></li> : null}
    </ul>
  );
}

function Heart({ on, toggle, name }: { on: boolean; toggle: () => void; name: string }) {
  return <button class={`heart${on ? " on" : ""}`} aria-pressed={on} aria-label={`${on ? "Remove" : "Add"} ${name} ${on ? "from" : "to"} favourites`} onClick={toggle}>{on ? "♥" : "♡"}</button>;
}

interface GridItem {
  key: string;
  name: string;
  image: string | undefined;
  onPick: () => void;
  fav?: { on: boolean; toggle: () => void };
  /** How far through, 0 to 1. */
  progress?: number | undefined;
}

function Grid({ items }: { items: GridItem[] }) {
  const [more, setMore] = useState(SHOW_AT_FIRST);
  useEffect(() => setMore(SHOW_AT_FIRST), [items.length]);
  if (items.length === 0) return <p class="muted pad">Nothing here.</p>;
  return (
    <>
      <ul class="grid">
        {items.slice(0, more).map((item) => (
          <li>
            <button class="main" onClick={item.onPick}>
              {item.image !== undefined ? <img src={`/watch/p?u=${encodeURIComponent(item.image)}`} alt="" loading="lazy" onError={(event) => ((event.currentTarget as HTMLImageElement).style.visibility = "hidden")} /> : <span class="poster" />}
              <span>{item.name}</span>
              {item.progress !== undefined ? <span class="bar"><span style={{ width: `${Math.round(item.progress * 100)}%` }} /></span> : null}
            </button>
            {item.fav !== undefined ? <Heart on={item.fav.on} toggle={item.fav.toggle} name={item.name} /> : null}
          </li>
        ))}
      </ul>
      {items.length > more ? <p class="pad"><button class="quiet" onClick={() => setMore(more + SHOW_AT_FIRST)}>Show more ({items.length - more})</button></p> : null}
    </>
  );
}

function Episodes({ source, show, library, fractionOf, onBack, onPlay }: { source: WebSource; show: Show; library: Library; fractionOf: (key: string) => number | undefined; onBack: () => void; onPlay: (show: Show, part: Part) => void }) {
  const state = useLoad(() => episodesOf(source, show), [source.id, show.id]);
  const bySeason = useMemo(() => {
    const groups = new Map<number, Part[]>();
    for (const part of state.value ?? []) groups.set(part.season, [...(groups.get(part.season) ?? []), part]);
    return [...groups.entries()];
  }, [state.value]);
  return (
    <div class="pad">
      <button class="quiet" onClick={onBack}>Back</button>
      <h2>{show.name} <Heart on={library.has("seriesFavs", show.key)} toggle={() => library.toggleFavourite("seriesFavs", show.key)} name={show.name} /></h2>
      {show.plot !== undefined ? <p class="muted">{show.plot}</p> : null}
      <List state={state} empty="No episodes." render={() => (
        <>{bySeason.map(([season, parts]) => (
          <section><h3>Season {season}</h3>
            <ul class="episodes">{parts.map((part) => {
              const done = fractionOf(part.key);
              return <li><button onClick={() => onPlay(show, part)}>{done === 1 ? "✓ " : ""}{part.number}. {part.title}{done !== undefined && done < 1 ? <span class="bar"><span style={{ width: `${Math.round(done * 100)}%` }} /></span> : null}</button></li>;
            })}</ul>
          </section>
        ))}</>
      )} />
    </div>
  );
}
