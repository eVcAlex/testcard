import type { ReactNode } from "react";
import type { Channel } from "./data.ts";
import { displayName } from "./state.ts";

/** The picture area: a CSS test pattern that server-renders, with the canvas (when the demo is live) laid over it. */
export function Preview({ channel, showRaw, children }: { channel: Channel; showRaw: boolean; children?: ReactNode }) {
  return (
    <div className={`dm-pv dm-h${channel.hue}`}>
      <span className="dm-pv-ring" aria-hidden="true" />
      <span className="dm-pv-name" aria-hidden="true">{displayName(channel, showRaw)}</span>
      <span className="dm-pv-bars" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>
      {children}
      <span className="dm-badge">Muted preview</span>
    </div>
  );
}
