import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WAITLIST_HREF } from "../site.ts";

const [path, hash] = WAITLIST_HREF.split("#") as [string, string];

/** Every "Join the beta waitlist" button on the page points at the waitlist form. On the page that holds the form, it scrolls only if the form is off screen, so repeat clicks don't nudge the page. */
export function WaitlistLink({ children = "Join the beta waitlist", className = "button" }: { children?: ReactNode; className?: string }) {
  const here = useRouterState({ select: (s) => s.location.pathname === path });
  return <Link to={path} hash={hash} hashScrollIntoView={here ? { block: "nearest" } : true} className={className}>{children}</Link>;
}
