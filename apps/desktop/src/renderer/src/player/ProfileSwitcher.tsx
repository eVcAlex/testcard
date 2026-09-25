import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.js";
import { ProfileAvatar } from "./ProfileAvatar.js";
import { useProfiles, useSwitchProfile } from "./useProfiles.js";

/**
 * The sidebar's profile switcher: who's watching, and a menu to pick someone else or manage
 * profiles. Hidden entirely with just one profile (Main) — nothing to switch to.
 */
export function ProfileSwitcher({ onManage }: { onManage: () => void }) {
  const { profiles, currentId, currentProfile } = useProfiles();
  const switchProfile = useSwitchProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (profiles.length < 2 || currentProfile === undefined) return null;

  return (
    <div className="pw-profile-switcher" ref={ref}>
      <button type="button" className="pw-profile-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ProfileAvatar profile={currentProfile} size={28} />
        <span className="pw-profile-trigger-name">{currentProfile.name}</span>
      </button>
      {open && (
        <div className="pw-profile-menu" role="menu">
          {profiles.map((profile) => (
            <button
              type="button"
              key={profile.id}
              role="menuitem"
              className="pw-profile-menu-row"
              disabled={switchProfile.isPending}
              onClick={() => {
                setOpen(false);
                if (profile.id !== currentId) switchProfile.mutate(profile.id);
              }}
            >
              <ProfileAvatar profile={profile} size={28} />
              <span className="pw-profile-menu-name">{profile.name}</span>
              {profile.id === currentId && <Icon name="check" size={14} />}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="pw-profile-menu-manage"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Manage profiles
          </button>
        </div>
      )}
      {switchProfile.isError && <p className="msg msg--error">{(switchProfile.error as Error).message}</p>}
    </div>
  );
}
