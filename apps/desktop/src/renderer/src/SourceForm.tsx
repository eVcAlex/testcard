import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceContent, SourceListItem } from "../../shared/ipc.js";

const ALL_CONTENT: SourceContent = { live: true, movies: true, series: true };

const CONTENT_OPTIONS: { key: keyof SourceContent; label: string; hint: string }[] = [
  { key: "live", label: "Live TV", hint: "Channels and the TV guide" },
  { key: "movies", label: "Movies", hint: "The film library" },
  { key: "series", label: "Series", hint: "Shows, seasons and episodes" },
];

/** How the add form's segmented control is set. Meaningless once editing — kind is fixed then. */
type Via = "url" | "xtream";

/** Which half of an existing source the form edits: how it connects, or how the app uses it. */
export type SourceSection = "connection" | "settings";

/**
 * Adds a source, or — pass an existing `source` — edits one in place. The id is preserved on
 * an edit, so favourites/recents survive it. `kind` can't change here: there's no kind toggle,
 * so which fields render (a single pasted-URL box, or Xtream's server/username/password) comes
 * straight from `source.kind` when editing, and from the `via` segmented control when adding.
 */
export function SourceForm({
  source,
  section = "connection",
  onDone,
  onCancel,
}: {
  source?: SourceListItem;
  /** When editing: "connection" = name, server/playlist, login. "settings" = content, guide, refresh. Adding shows everything. */
  section?: SourceSection;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = source !== undefined;
  const showConnection = !editing || section === "connection";
  const showSettings = !editing || section === "settings";
  const queryClient = useQueryClient();

  const [via, setVia] = useState<Via>("url");
  const [name, setName] = useState(source?.name ?? "");
  const [pastedUrl, setPastedUrl] = useState(source?.kind === "m3u" ? source.playlistUrl : "");
  const [epgUrl, setEpgUrl] = useState(source?.epgUrl ?? "");
  const [xtreamBaseUrl, setXtreamBaseUrl] = useState(source?.kind === "xtream" ? source.baseUrl : "");
  const [xtreamUsername, setXtreamUsername] = useState("");
  const [xtreamPassword, setXtreamPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [content, setContent] = useState<SourceContent>(source?.content ?? ALL_CONTENT);
  // "" means manual-only (Off) — the one non-numeric option in an otherwise numeric select.
  const [refreshInterval, setRefreshInterval] = useState(
    source?.refreshIntervalHours !== undefined ? String(source.refreshIntervalHours) : "",
  );

  // Which fields are showing right now — the add form's own tab, or the fixed kind of the
  // source being edited.
  const showing: Via = editing ? (source.kind === "xtream" ? "xtream" : "url") : via;
  const noContent = showSettings && !content.live && !content.movies && !content.series;

  // Editing an Xtream login: fetch the stored username and password now (not with the source list)
  // and fill the fields. gcTime 0 keeps the password out of the query cache once the form closes.
  const needsLogin = editing && source.kind === "xtream" && showConnection;
  const login = useQuery({
    queryKey: ["source-login", source?.id],
    queryFn: () => window.testcard.sources.login(source!.id),
    enabled: needsLogin,
    gcTime: 0,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (login.data == null) return;
    setXtreamUsername(login.data.username);
    setXtreamPassword(login.data.password);
  }, [login.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const epg = epgUrl.trim();
      const interval = refreshInterval === "" ? undefined : Number(refreshInterval);

      if (!editing) {
        if (via === "xtream") {
          return window.testcard.sources.add({
            name,
            via: "xtream",
            baseUrl: xtreamBaseUrl.trim(),
            username: xtreamUsername.trim(),
            password: xtreamPassword,
            content,
            ...(epg !== "" ? { epgUrl: epg } : {}),
            ...(interval !== undefined ? { refreshIntervalHours: interval } : {}),
          });
        }
        return window.testcard.sources.add({
          name,
          via: "url",
          pastedUrl,
          content,
          ...(epg !== "" ? { epgUrl: epg } : {}),
          ...(interval !== undefined ? { refreshIntervalHours: interval } : {}),
        });
      }

      // Editing sends only the half being edited; anything omitted is left as it was.
      const settingsPatch =
        section === "settings"
          ? {
              epgUrl: epg,
              refreshIntervalHours: interval ?? null,
              content,
            }
          : {};

      if (source.kind === "m3u") {
        const url = pastedUrl.trim();
        return window.testcard.sources.update(source.id, {
          name: section === "connection" ? name : source.name,
          ...settingsPatch,
          ...(section === "connection" && url !== "" && url !== source.playlistUrl ? { playlistUrl: url } : {}),
        });
      }

      const baseUrl = xtreamBaseUrl.trim();
      return window.testcard.sources.update(source.id, {
        name: section === "connection" ? name : source.name,
        ...settingsPatch,
        ...(section === "connection"
          ? {
              xtream: {
                ...(baseUrl !== "" && baseUrl !== source.baseUrl ? { baseUrl } : {}),
                ...(xtreamUsername.trim() !== "" ? { username: xtreamUsername.trim() } : {}),
                ...(xtreamPassword !== "" ? { password: xtreamPassword } : {}),
              },
            }
          : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      if (!editing) {
        setName("");
        setPastedUrl("");
        setEpgUrl("");
        setXtreamBaseUrl("");
        setXtreamUsername("");
        setXtreamPassword("");
        setRefreshInterval("");
      }
      onDone();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="add-source">
      {!editing && (
        <div className="pw-seg" role="group" aria-label="Source type">
          <button
            type="button"
            className="pw-seg-btn"
            data-active={via === "url"}
            aria-pressed={via === "url"}
            onClick={() => setVia("url")}
          >
            M3U playlist
          </button>
          <button
            type="button"
            className="pw-seg-btn"
            data-active={via === "xtream"}
            aria-pressed={via === "xtream"}
            onClick={() => setVia("xtream")}
          >
            Xtream Codes
          </button>
        </div>
      )}

      {showConnection && (
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
      )}

      {showConnection && showing === "url" && (
        <label className="field">
          <span>Playlist URL</span>
          <input
            className="input"
            value={pastedUrl}
            onChange={(e) => setPastedUrl(e.target.value)}
            required={!editing}
          />
          <p className="msg msg--hint">
            An M3U/M3U8 playlist URL, or an Xtream <code>get.php</code> URL. We&rsquo;ll work out
            which.
          </p>
        </label>
      )}

      {showConnection && showing === "xtream" && (
        <>
          <label className="field">
            <span>Server URL</span>
            <input
              className="input"
              value={xtreamBaseUrl}
              onChange={(e) => setXtreamBaseUrl(e.target.value)}
              required={!editing}
            />
            <p className="msg msg--hint">
              The portal address, e.g. <code>http://line.example.com:8080</code>, without{" "}
              <code>/get.php</code>.
            </p>
          </label>
          <label className="field">
            <span>Username</span>
            <input
              className="input"
              value={xtreamUsername}
              onChange={(e) => setXtreamUsername(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <div className="input-reveal">
              <input
                className="input"
                type={revealPassword ? "text" : "password"}
                value={xtreamPassword}
                onChange={(e) => setXtreamPassword(e.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="btn btn--ghost" onClick={() => setRevealPassword((shown) => !shown)}>
                {revealPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        </>
      )}

      {showSettings && (
        <>
          <h4 className="pw-form-section">Content</h4>
          <div className="pw-toggles">
            {CONTENT_OPTIONS.map((option) => (
              <label key={option.key} className="pw-toggle">
                <span className="pw-toggle-text">
                  <b>{option.label}</b>
                  <small>{option.hint}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={content[option.key]}
                  onChange={(e) => setContent({ ...content, [option.key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
          <p className="msg msg--hint">
            {noContent
              ? "Turn on at least one, or this source has nothing to show."
              : editing
                ? "Turning something off removes it from this device. Favourites and progress come back if you turn it on again."
                : "Choose what to load from this provider. You can change this later."}
          </p>
        </>
      )}

      {showSettings && (
        <>
      <h4 className="pw-form-section">Guide and updates</h4>
      <label className="field">
        <span>XMLTV / EPG URL</span>
        <input className="input" value={epgUrl} onChange={(e) => setEpgUrl(e.target.value)} />
        <p className="msg msg--hint">Optional. Leave blank to auto-detect one on refresh.</p>
      </label>

      <label className="field">
        <span>Auto-refresh</span>
        <select className="input" value={refreshInterval} onChange={(e) => setRefreshInterval(e.target.value)}>
          <option value="">Off (manual only)</option>
          <option value="1">Every hour</option>
          <option value="3">Every 3 hours</option>
          <option value="6">Every 6 hours</option>
          <option value="12">Every 12 hours</option>
          <option value="24">Every 24 hours</option>
        </select>
        <p className="msg msg--hint">Reloads channels, movies, series and the guide in the background while Testcard is open.</p>
      </label>
        </>
      )}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={mutation.isPending || noContent || (needsLogin && login.data == null)}
        >
          {mutation.isPending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add source"}
        </button>
      </div>

      {mutation.isError && <p className="msg msg--error">{(mutation.error as Error).message}</p>}
    </form>
  );
}
