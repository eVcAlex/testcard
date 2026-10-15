import { useEffect, useMemo, useState } from "preact/hooks";
import { categories, episodesOf, films, forgetCatalogue, liveChannels, shows, type Film, type Part, type Show } from "./catalogue.ts";
import { feedsFor, type WebChannel } from "./feeds.ts";
import type { Library, Shelf } from "./library.ts";
import { Manage } from "./Manage.tsx";
import { Player, type PlayRequest } from "./Player.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { pinMatches, profileColour, profileGlyph, type WebProfile } from "./profiles.ts";
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
  const [managing, setManaging] = useState(false);

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
    setManaging(false);
    setAccount(undefined);
  };
  // One profile is the account itself: no need to ask who is watching.
  const autoOpen = (opened: Account) => {
    const only = opened.profiles.length === 1 ? opened.profiles[0] : undefined;
    if (only !== undefined && only.pin === null && opened.sources.length > 0) void opened.openLibrary(only.id).then((opened_) => { setLibrary(opened_); setProfile(only); });
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
    // An account with nothing in it yet starts by adding a source.
    if (opened.sources.length === 0) setManaging(true);
    else autoOpen(opened);
  }} />;
  if (managing) return <Manage account={account} onChanged={setAccount} onSignOut={leave} onDone={() => { setManaging(false); if (profile === undefined) autoOpen(account); }} />;
  if (profile === undefined || library === undefined) return <Profiles profiles={account.profiles} onPick={choose} onManage={() => setManaging(true)} onSignOut={leave} />;
  return (
    <>
      <Browser
        sources={account.sources}
        library={library}
        profile={account.profiles.length > 1 ? profile : undefined}
        onPlay={setPlay}
        onSwitchProfile={switchProfile}
        onManage={account.profiles.length === 1 ? () => setManaging(true) : undefined}
        onSignOut={leave}
      />
      {play !== undefined ? <Player request={play} onClose={() => { setPlay(undefined); void library.send(); }} /> : null}
    </>
  );
}

const Disc = ({ profile, size }: { profile: WebProfile; size: number }) => (
  <span class="disc" aria-hidden="true" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px`, background: profileColour(profile) }}>{profileGlyph(profile)}</span>
);

/** Who is watching. A profile with a PIN asks for it, the one set in the apps. */
function Profiles({ profiles, onPick, onManage, onSignOut }: { profiles: WebProfile[]; onPick: (profile: WebProfile) => Promise<void>; onManage: () => void; onSignOut: () => void }) {
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
      <main class="gate">
        <div class="gate-box">
          <div style={{ display: "grid", justifyItems: "center", gap: "12px" }}><Disc profile={asking} size={72} /><h1>{asking.name}</h1></div>
          <form class="card" onSubmit={(event) => {
            event.preventDefault();
            const digits = String(new FormData(event.currentTarget as HTMLFormElement).get("pin"));
            if (pinMatches(asking, digits)) void open(asking);
            else setWrong(true);
          }}>
            <label class="field"><span>PIN</span><input class="input" name="pin" type="password" inputMode="numeric" autocomplete="off" autofocus required /></label>
            <button class="btn btn--primary btn--lg" type="submit" disabled={busy}>Watch</button>
            <button type="button" class="btn btn--ghost" onClick={() => { setAsking(undefined); setWrong(false); }}>Back</button>
            {wrong ? <p class="problem" role="alert">That PIN is not right.</p> : null}
          </form>
        </div>
      </main>
    );
  }
  return (
    <main class="gate">
      <div class="gate-box gate-box--wide">
        <h1 class="brand" style={{ fontSize: "var(--t-lead)" }}>TEST<span>CARD</span></h1>
        <h1>Who is watching?</h1>
        <ul class="who">
          {profiles.map((profile) => (
            <li><button disabled={busy} onClick={() => (profile.pin !== null ? setAsking(profile) : void open(profile))}>
              <Disc profile={profile} size={80} />
              <span class="nm">{profile.name}{profile.pin !== null ? <Icon name="lock" size={14} /> : null}</span>
            </button></li>
          ))}
        </ul>
        <button class="btn btn--ghost" onClick={onManage}>Manage sources and profiles</button>
        <button class="btn btn--ghost" onClick={onSignOut}>Sign out</button>
      </div>
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
      onSignedIn(await signInAndLoad(String(form.get("email")).trim(), String(form.get("password"))));
    } catch (reason) {
      setError(plainReason(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="gate">
      <div class="gate-box">
        <h1 class="brand" style={{ fontSize: "var(--t-title)" }}>TEST<span>CARD</span></h1>
        <p class="muted">Sign in with your Testcard account to watch in the browser. Your sources open here, on this device, with your password.</p>
        <form class="card" onSubmit={submit}>
          <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required disabled={busy} /></label>
          <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required disabled={busy} /></label>
          <button class="btn btn--primary btn--lg" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
          {error !== undefined ? <p class="problem" role="alert">{error}</p> : null}
        </form>
        <p class="fine">Video from your provider is relayed through Testcard's servers so the browser can play it. Favourites and your place in films sync with the apps; nothing else is stored in this browser.</p>
      </div>
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
const TABS: readonly { id: Tab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "movies", label: "Movies", icon: "film" },
  { id: "series", label: "Series", icon: "layers" },
];

/** Items in the order a shelf keeps its keys (newest first, or the viewer's own order); those not in the list are left out. */
function onShelf<T>(items: readonly T[], keyOf: (item: T) => string | undefined, keys: readonly string[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined && key !== "") byKey.set(key, item);
  }
  return keys.flatMap((key) => (byKey.has(key) ? [byKey.get(key) as T] : []));
}

function Browser({ sources, library, profile, onPlay, onSwitchProfile, onManage, onSignOut }: { sources: WebSource[]; library: Library; profile: WebProfile | undefined; onPlay: (request: PlayRequest) => void; onSwitchProfile: () => void; onManage: (() => void) | undefined; onSignOut: () => void }) {
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

  const tabName = TABS.find((entry) => entry.id === tab)?.label ?? "";
  const title = searching ? `Search ${tabName}` : (chips.find((c) => c.id === category)?.name ?? tabName).replace(/^★ /, "");

  return (
    <div class="pw-app">
      <aside class="pw-sidebar">
        <h1 class="brand">TEST<span>CARD</span></h1>
        {profile !== undefined ? (
          <div class="pw-profile">
            <button class="pw-profile-trigger" onClick={onSwitchProfile} aria-label={`${profile.name}. Switch profile`}>
              <Disc profile={profile} size={28} />
              <span class="name">{profile.name}</span>
            </button>
          </div>
        ) : null}
        {sources.length > 1 ? (
          <label class="pw-source">
            <span>Source</span>
            <select class="input" value={source.id} onChange={(event) => setSourceId((event.currentTarget as HTMLSelectElement).value)} aria-label="Source">
              {sources.map((candidate) => <option value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>
        ) : null}
        <nav class="pw-nav">
          {TABS.map((entry) => (
            <button class="pw-nav-item" data-active={tab === entry.id} onClick={() => { setTab(entry.id); setQuery(""); }}>
              <Icon name={entry.icon} size={18} />{entry.label}
            </button>
          ))}
        </nav>
        <div class="pw-nav-group">Categories</div>
        <div class="pw-cats">
          {cats.error !== undefined ? <p class="problem pad">{cats.error} <button class="btn" onClick={cats.retry}>Try again</button></p> : null}
          {cats.loading ? <span class="muted pad">Loading...</span> : null}
          {chips.map((c) => (
            <button class="pw-cat" data-active={!searching && c.id === category} onClick={() => { setCategory(c.id); setShow(undefined); setQuery(""); }}>
              {c.id === FAVOURITES ? <Icon name="star" size={13} /> : c.id === RECENT ? <Icon name="clock" size={13} /> : null}
              <span>{c.name.replace(/^★ /, "")}</span>
            </button>
          ))}
        </div>
        <div class="pw-foot">{onManage !== undefined ? <button class="btn btn--ghost" onClick={onManage}><span>Manage</span></button> : null}<button class="btn btn--ghost" onClick={onSignOut}><span>Sign out</span><Icon name="x" size={14} /></button></div>
      </aside>
      <section class="pw-main">
        <header class="pw-head">
          <h2>{title}</h2>
          <label class="pw-search"><Icon name="search" /><input type="search" placeholder="Search (2+ letters)" value={query} onInput={(event) => { setQuery((event.currentTarget as HTMLInputElement).value); setShow(undefined); }} /></label>
        </header>
        <div class="pw-scroll">
          {tab === "live" ? (
            <List state={live} empty={special ? "Nothing here yet. Star a channel to keep it here." : "No channels here."} render={(channels) => (
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
        </div>
      </section>
    </div>
  );
}

function List<T>({ state, render, empty }: { state: { value?: T[]; error?: string; loading: boolean; retry: () => void }; render: (items: T[]) => preact.ComponentChildren; empty: string }) {
  if (state.loading) return <div class="pw-loading" aria-busy="true" aria-label="Loading from your provider">{Array.from({ length: 8 }, () => <div class="skeleton" />)}<p class="muted">Loading from your provider. The first time can take a while...</p></div>;
  if (state.error !== undefined) return <div class="pw-empty"><p class="problem">{state.error}</p><p><button class="btn" onClick={state.retry}><Icon name="refresh" />Try again</button></p></div>;
  if (state.value === undefined) return <p class="pw-empty">{empty}</p>;
  const out = render(state.value);
  return Array.isArray(out) && out.length === 0 ? <p class="pw-empty">{empty}</p> : <>{out}</>;
}

const through = (address: string) => `/watch/p?u=${encodeURIComponent(address)}`;
const hideBroken = (event: Event) => ((event.currentTarget as HTMLImageElement).style.visibility = "hidden");
/** Two letters for a channel with no logo, as the desktop shows. */
function initials(name: string): string {
  const words = name.replace(/[^a-z0-9 ]/gi, "").trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "TV";
}

function Star({ on, toggle, name, class: className }: { on: boolean; toggle: () => void; name: string; class: string }) {
  return (
    <button class={className} data-fav={on} aria-pressed={on} aria-label={`${on ? "Remove" : "Add"} ${name} ${on ? "from" : "to"} favourites`} onClick={toggle}>
      <Icon name="star" size={15} filled={on} />
    </button>
  );
}

function ShowMore({ left, onMore }: { left: number; onMore: () => void }) {
  return left > 0 ? <div class="pw-more"><button class="btn" onClick={onMore}>Show more ({left})</button></div> : null;
}

function ChannelList({ channels, library, onPlay }: { channels: WebChannel[]; library: Library; onPlay: (channel: WebChannel) => void }) {
  const [more, setMore] = useState(SHOW_AT_FIRST);
  useEffect(() => setMore(SHOW_AT_FIRST), [channels.length]);
  if (channels.length === 0) return <p class="pw-empty">No channels here.</p>;
  return (
    <>
      <ul class="pw-grid">
        {channels.slice(0, more).map((channel) => (
          <li class="pw-card">
            <button class="pw-card-main" onClick={() => onPlay(channel)}>
              <span class="pw-logo">{channel.logo !== undefined ? <img src={through(channel.logo)} alt="" loading="lazy" onError={hideBroken} /> : initials(channel.name)}</span>
              <span class="pw-card-name">{channel.name}</span>
            </button>
            {channel.libKey !== undefined ? <Star class="pw-star" on={library.has("channelFavs", channel.libKey)} toggle={() => library.toggleFavourite("channelFavs", channel.libKey as string)} name={channel.name} /> : null}
          </li>
        ))}
      </ul>
      <ShowMore left={channels.length - more} onMore={() => setMore(more + SHOW_AT_FIRST)} />
    </>
  );
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
  if (items.length === 0) return <p class="pw-empty">Nothing here.</p>;
  return (
    <>
      <ul class="pw-posters">
        {items.slice(0, more).map((item) => (
          <li class="pw-poster">
            <button class="pw-poster-card" onClick={item.onPick}>
              <span class="pw-poster-image">
                {item.image !== undefined ? <img src={through(item.image)} alt="" loading="lazy" onError={hideBroken} /> : <Icon name="film" size={28} />}
                <span class="pw-poster-play"><Icon name="play" size={20} /></span>
                {item.progress !== undefined && item.progress < 1 ? <span class="pw-poster-progress"><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></span> : null}
              </span>
              <span class="pw-poster-title">{item.name}</span>
            </button>
            {item.fav !== undefined ? <Star class="pw-poster-fav" on={item.fav.on} toggle={item.fav.toggle} name={item.name} /> : null}
          </li>
        ))}
      </ul>
      <ShowMore left={items.length - more} onMore={() => setMore(more + SHOW_AT_FIRST)} />
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
    <div class="pw-show">
      <div class="pw-show-top">
        <button class="btn" onClick={onBack}><Icon name="back" />Back</button>
        <Star class="pw-star" on={library.has("seriesFavs", show.key)} toggle={() => library.toggleFavourite("seriesFavs", show.key)} name={show.name} />
      </div>
      <h2>{show.name}</h2>
      {show.plot !== undefined ? <p class="muted">{show.plot}</p> : null}
      <List state={state} empty="No episodes." render={() => (
        <>{bySeason.map(([season, parts]) => (
          <section><h3>Season {season}</h3>
            <ul class="pw-eps">{parts.map((part) => {
              const done = fractionOf(part.key);
              return (
                <li><button class="pw-ep" onClick={() => onPlay(show, part)}>
                  <span class="num">{part.number}</span>
                  <span class="title">{part.title}</span>
                  {done === 1 ? <span class="done"><Icon name="check" /></span> : null}
                  {done !== undefined && done < 1 ? <span class="bar"><i style={{ width: `${Math.round(done * 100)}%` }} /></span> : null}
                </button></li>
              );
            })}</ul>
          </section>
        ))}</>
      )} />
    </div>
  );
}
