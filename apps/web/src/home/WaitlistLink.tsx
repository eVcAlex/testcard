import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WAITLIST_HREF } from "../site.ts";

const [path, hash] = WAITLIST_HREF.split("#") as [string, string];

/** Every "Join the beta waitlist" button on the page points at the waitlist form. */
export function WaitlistLink({ children = "Join the beta waitlist", className = "button" }: { children?: ReactNode; className?: string }) {
  return <Link to={path} hash={hash} className={className}>{children}</Link>;
}
