import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@testcard/core";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Icon } from "../components/Icon.js";
import { opensUp } from "../lib/menu.js";
import { ProfileAvatar } from "./ProfileAvatar.js";

/** One row on the Profiles panel: avatar, name, and a kebab menu (Choose avatar / Rename / Delete). */
export function ProfileRow({
  profile,
  isMain,
  isCurrent,
  onRename,
  onAvatar,
}: {
  profile: Profile;
  isMain: boolean;
  isCurrent: boolean;
  onRename: () => void;
  onAvatar: () => void;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const remove = useMutation({
    mutationFn: () => window.testcard.profiles.remove(profile.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const canDelete = !isMain && !isCurrent;

  return (
    <li className="pw-src-card">
      <ProfileAvatar profile={profile} size={40} />
      <div className="pw-src-body">
        <div className="pw-src-title">
          <span className="pw-src-name">{profile.name}</span>
          {isCurrent && <span className="pill">WATCHING NOW</span>}
        </div>
        {isMain && <span className="pw-src-host">Your account&rsquo;s own</span>}
        {remove.isError && <p className="msg msg--error">{(remove.error as Error).message}</p>}
      </div>
      <div className="pw-source-menu" ref={menuRef}>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={`${profile.name} actions`}
          aria-expanded={menuOpen}
          onClick={(event) => {
            setMenuUp(opensUp(event.currentTarget));
            setMenuOpen((open) => !open);
          }}
        >
          <Icon name="more" />
        </button>
        {menuOpen && (
          <div className={menuUp ? "pw-source-menu-pop pw-source-menu-pop--up" : "pw-source-menu-pop"} role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onAvatar();
              }}
            >
              <Icon name="grid" />
              Choose avatar
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
            >
              <Icon name="edit" />
              Rename
            </button>
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                className="pw-source-menu-danger"
                disabled={remove.isPending}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmingRemove(true);
                }}
              >
                <Icon name="trash" />
                {remove.isPending ? "Deleting…" : "Delete profile"}
              </button>
            )}
          </div>
        )}
      </div>
      {confirmingRemove && (
        <ConfirmDialog
          title={`Delete ${profile.name}?`}
          body="Its favourites, recents and progress are deleted from your account."
          confirmLabel="Delete"
          busy={remove.isPending}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false);
            remove.mutate();
          }}
        />
      )}
    </li>
  );
}
