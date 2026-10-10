import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WAITLIST_HREF } from "../site.ts";

/** Every "Join the beta waitlist" button on the page points at the page that holds the form, which sits just under its heading. */
export function WaitlistLink({ children = "Join the beta waitlist", className = "button" }: { children?: ReactNode; className?: string }) {
  return <Link to={WAITLIST_HREF} className={className}>{children}</Link>;
}
