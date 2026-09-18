import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon.js";

/**
 * A right-hand detail panel over a dimming scrim. Escape or a click on the scrim closes it, and
 * focus moves into it on open so the keyboard user isn't left behind the scrim.
 */
export function Drawer({
  label,
  backdropUrl,
  onClose,
  children,
}: {
  label: string;
  /** Optional artwork, blurred and dimmed behind the content. */
  backdropUrl?: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="pw-drawer-root">
      <div className="pw-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="pw-drawer" role="dialog" aria-label={label}>
        {backdropUrl ? (
          <div className="pw-drawer-backdrop" style={{ backgroundImage: `url("${backdropUrl}")` }} aria-hidden="true" />
        ) : null}
        <button ref={closeRef} type="button" className="pw-drawer-close btn btn--ghost btn--icon" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
        <div className="pw-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
