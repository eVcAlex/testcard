import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SourceListItem } from "../../shared/ipc.js";

/**
 * Adds a source, or — pass an existing `source` — edits one in place. The id is preserved on
 * an edit, so favourites/recents survive it. `kind` can't change here: there's no kind toggle,
 * so which fields render (a single pasted-URL box, or Xtream's server/username/password) comes
 * straight from `source.kind` when editing.
 */
export function SourceForm({
  source,
  onDone,
  onCancel,
}: {
  source?: SourceListItem;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const editing = source !== undefined;

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

  const mutation = useMutation({
    mutationFn: () => {
      const epg = epgUrl.trim();
      const interval = refreshInterval === "" ? undefined : Number(refreshInterval);

      if (!editing) {
        return window.testcard.sources.add({
          name,
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
      if (!editing) {
        setName("");
        setPastedUrl("");
        setEpgUrl("");
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
      <p className="section-title">{editing ? "Edit source" : "Add source"}</p>

      <input
        className="input"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      {(!editing || source.kind === "m3u") && (
        <input
          className="input"
          placeholder={editing ? "Playlist URL" : "Paste your M3U or get.php URL"}
          value={pastedUrl}
          onChange={(e) => setPastedUrl(e.target.value)}
          required={!editing}
        />
      )}

      {editing && source.kind === "xtream" && (
        <>
          <input
            className="input"
            placeholder="Server URL"
            value={xtreamBaseUrl}
            onChange={(e) => setXtreamBaseUrl(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Username — leave blank to keep current"
            value={xtreamUsername}
            onChange={(e) => setXtreamUsername(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Password — leave blank to keep current"
            value={xtreamPassword}
            onChange={(e) => setXtreamPassword(e.target.value)}
          />
        </>
      )}

      <input
        className="input"
        placeholder="XMLTV / EPG URL — optional"
        value={epgUrl}
        onChange={(e) => setEpgUrl(e.target.value)}
      />

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
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {mutation.isError && <p className="msg msg--error">{(mutation.error as Error).message}</p>}
    </form>
  );
}
