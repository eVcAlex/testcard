import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

/** An empty list says what is missing and what to do about it. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="pw-empty-state">
      <span className="pw-empty-icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <p className="pw-empty-title">{title}</p>
      {hint !== undefined && <p className="pw-empty-hint">{hint}</p>}
      {action}
    </div>
  );
}
