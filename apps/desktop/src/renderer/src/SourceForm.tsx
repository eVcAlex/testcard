import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SourceListItem } from "../../shared/ipc.js";

/** How the add form's segmented control is set. Meaningless once editing — kind is fixed then. */
type Via = "url" | "xtream";

/**
 * Adds a source, or — pass an existing `source` — edits one in place. The id is preserved on
 * an edit, so favourites/recents survive it. `kind` can't change here: there's no kind toggle,
 * so which fields render (a single pasted-URL box, or Xtream's server/username/password) comes
 * straight from `source.kind` when editing, and from the `via` segmented control when adding.
 */
export function SourceForm({
  source,
  onDone,
  onCancel,
}: {
  source?: SourceListItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = source !== undefined;
  const queryClient = useQueryClient();

  const [via, setVia] = useState<Via>("url");
  const [name, setName] = useState(source?.name ?? "");
  const [pastedUrl, setPastedUrl] = useState(source?.kind === "m3u" ? source.playlistUrl : "");
  const [epgUrl, setEpgUrl] = useState(source?.epgUrl ?? "");
  const [xtreamBaseUrl, setXtreamBaseUrl] = useState(source?.kind === "xtream" ? source.baseUrl : "");
  const [xtreamUsername, setXtreamUsername] = useState("");
  const [xtreamPassword, setXtreamPassword] = useState("");
  // "" means manual-only (Off) — the one non-numeric option in an otherwise numeric select.
  const [refreshInterval, setRefreshInterval] = useState(
    source?.refreshIntervalHours !== undefined ? String(source.refreshIntervalHours) : "",
  );

  // Which fields are showing right now — the add form's own tab, or the fixed kind of the
  // source being edited.
  const showing: Via = editing ? (source.kind === "xtream" ? "xtream" : "url") : via;

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
            ...(epg !== "" ? { epgUrl: epg } : {}),
            ...(interval !== undefined ? { refreshIntervalHours: interval } : {}),
          });
        }
        return window.testcard.sources.add({
          name,
          via: "url",
          pastedUrl,
          ...(epg !== "" ? { epgUrl: epg } : {}),
          ...(interval !== undefined ? { refreshIntervalHours: interval } : {}),
        });
      }

      if (source.kind === "m3u") {
        const url = pastedUrl.trim();
        return window.testcard.sources.update(source.id, {
          name,
          epgUrl: epg,
          refreshIntervalHours: interval ?? null,
          ...(url !== "" && url !== source.playlistUrl ? { playlistUrl: url } : {}),
        });
      }

      const baseUrl = xtreamBaseUrl.trim();
      return window.testcard.sources.update(source.id, {
        name,
        epgUrl: epg,
        refreshIntervalHours: interval ?? null,
        xtream: {
          ...(baseUrl !== "" && baseUrl !== source.baseUrl ? { baseUrl } : {}),
          ...(xtreamUsername.trim() !== "" ? { username: xtreamUsername.trim() } : {}),
          ...(xtreamPassword !== "" ? { password: xtreamPassword } : {}),
        },
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

      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      {showing === "url" && (
        <label className="field">
          <span>Playlist URL</span>
          <input
            className="input"
            value={pastedUrl}
            onChange={(e) => setPastedUrl(e.target.value)}
            required={!editing}
          />
          <p className="msg msg--hint">
            An M3U/M3U8 playlist URL, or an Xtream <code>get.php</code> URL — we&rsquo;ll work out
            which.
          </p>
        </label>
      )}

      {showing === "xtream" && (
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
              The portal address, e.g. <code>http://line.example.com:8080</code> — without{" "}
              <code>/get.php</code>.
            </p>
          </label>
          <label className="field">
            <span>Username</span>
            <input
              className="input"
              value={xtreamUsername}
              onChange={(e) => setXtreamUsername(e.target.value)}
              required={!editing}
              placeholder={editing ? "Leave blank to keep the current username" : undefined}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={xtreamPassword}
              onChange={(e) => setXtreamPassword(e.target.value)}
              required={!editing}
              placeholder={editing ? "Leave blank to keep the current password" : undefined}
            />
          </label>
        </>
      )}

      <label className="field">
        <span>XMLTV / EPG URL</span>
        <input className="input" value={epgUrl} onChange={(e) => setEpgUrl(e.target.value)} />
        <p className="msg msg--hint">Optional — leave blank to auto-detect one on refresh.</p>
      </label>

      <label className="field">
        <span>Auto-refresh</span>
        <select className="input" value={refreshInterval} onChange={(e) => setRefreshInterval(e.target.value)}>
          <option value="">Off — manual only</option>
          <option value="6">Every 6 hours</option>
          <option value="12">Every 12 hours</option>
          <option value="24">Every 24 hours</option>
        </select>
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={mutation.isPending}>
          {mutation.isPending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add source"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {mutation.isError && <p className="msg msg--error">{(mutation.error as Error).message}</p>}
    </form>
  );
}
