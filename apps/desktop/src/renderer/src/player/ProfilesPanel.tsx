import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { AVATARS, MAIN_PROFILE_ID, PROFILE_COLOURS } from "./profileDisplay.js";
import { ProfileAvatar } from "./ProfileAvatar.js";
import { ProfileRow } from "./ProfileRow.js";
import { useProfiles } from "./useProfiles.js";

/** As many as the panel offers room for. */
const MAX_PROFILES = 6;

type Naming = { profile?: Profile; text: string };

/** Add, rename, re-dress and delete the profiles on this account. No PIN here — see the panel's own note. */
export function ProfilesPanel() {
  const { profiles, currentId } = useProfiles();
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["profiles"] });

  const [naming, setNaming] = useState<Naming>();
  const [dressingId, setDressingId] = useState<string>();
  const dressed = profiles.find((profile) => profile.id === dressingId);

  const add = useMutation({
    mutationFn: (name: string) => window.testcard.profiles.add(name),
    onSuccess: (profile) => {
      invalidate();
      setDressingId(profile.id); // straight on to its avatar, as the TV's own flow does
    },
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; avatar?: string | null; colour?: number } }) =>
      window.testcard.profiles.update(id, patch),
    onSuccess: invalidate,
  });

  const saveName = () => {
    if (naming === undefined) return;
    const name = naming.text.trim().slice(0, 20);
    if (name === "") return;
    if (naming.profile !== undefined) update.mutate({ id: naming.profile.id, patch: { name } });
    else add.mutate(name);
    setNaming(undefined);
  };

  return (
    <section className="pw-panel">
      <div className="pw-panel-head">
        <h3>Profiles</h3>
        {profiles.length < MAX_PROFILES && (
          <button type="button" className="btn btn--ghost pw-panel-action" onClick={() => setNaming({ text: "" })}>
            <Icon name="plus" /> Add profile
          </button>
        )}
      </div>
      <p className="pw-panel-note">
        Profiles are on your account, so they're on all your devices. Each has its own favourites, recents and
        progress everywhere. Switching here never asks for a PIN, even for a profile locked with one on the TV.
      </p>
      <ul className="pw-src-list">
        {profiles.map((profile) => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            isMain={profile.id === MAIN_PROFILE_ID}
            isCurrent={profile.id === currentId}
            onRename={() => setNaming({ profile, text: profile.name })}
            onAvatar={() => setDressingId(profile.id)}
          />
        ))}
      </ul>

      {naming !== undefined && (
        <div className="pw-confirm-backdrop" onClick={() => setNaming(undefined)}>
          <div className="pw-confirm" onClick={(event) => event.stopPropagation()}>
            <h3>{naming.profile !== undefined ? "Rename profile" : "Add a profile"}</h3>
            <label className="field">
              <span>Name</span>
              <input
                className="input"
                autoFocus
                maxLength={20}
                value={naming.text}
                onChange={(event) => setNaming((now) => (now === undefined ? now : { ...now, text: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveName();
                }}
              />
            </label>
            <div className="pw-confirm-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setNaming(undefined)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" disabled={naming.text.trim() === ""} onClick={saveName}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {dressed !== undefined && (
        <div className="pw-confirm-backdrop" onClick={() => setDressingId(undefined)}>
          <div className="pw-confirm pw-confirm--wide" onClick={(event) => event.stopPropagation()}>
            <div className="pw-dress-head">
              <ProfileAvatar profile={dressed} size={64} />
              <h3>{dressed.name}</h3>
            </div>
            <div className="pw-avatar-grid">
              {[null, ...AVATARS.map((entry) => entry.id)].map((avatarId) => (
                <button
                  type="button"
                  key={avatarId ?? "letter"}
                  className="pw-avatar-choice"
                  data-active={avatarId === dressed.avatar}
                  onClick={() => update.mutate({ id: dressed.id, patch: { avatar: avatarId } })}
                >
                  <ProfileAvatar profile={{ ...dressed, avatar: avatarId }} size={48} />
                </button>
              ))}
            </div>
            <div className="pw-colour-row">
              {PROFILE_COLOURS.map((colour, index) => (
                <button
                  type="button"
                  key={colour}
                  className="pw-colour-swatch"
                  data-active={dressed.colour % PROFILE_COLOURS.length === index}
                  style={{ background: colour }}
                  aria-label={`Colour ${index + 1}`}
                  onClick={() => update.mutate({ id: dressed.id, patch: { colour: index } })}
                />
              ))}
            </div>
            <div className="pw-confirm-actions">
              <button type="button" className="btn btn--primary" onClick={() => setDressingId(undefined)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
