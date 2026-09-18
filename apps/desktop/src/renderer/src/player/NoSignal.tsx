import { useEffect, useState } from "react";

/**
 * The seven-bar SMPTE colour-bar sequence, in broadcast order. Used once here and nowhere
 * else. These are a broadcast spec, not theme colour — they stay literal across every theme
 * and every reskin, unlike everything else in this file's stylesheet.
 */
const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

/**
 * Shown inside the picture well when a channel doesn't return video within the 10s timeout
 * (CONTEXT.md "Dead channel" — an expected state at 18k-channel scale, not an error). The
 * mpv window is hidden whenever this is visible, so the two never overlap.
 */
export function NoSignal({
  channelName,
  message,
  onRetry,
  onOpenInVlc,
  vlcAvailable,
}: {
  channelName: string;
  message?: string;
  onRetry: () => void;
  onOpenInVlc: () => Promise<void>;
  vlcAvailable: boolean;
}) {
  const [vlcBusy, setVlcBusy] = useState(false);
  const [vlcError, setVlcError] = useState<string | null>(null);

  useEffect(() => {
    setVlcBusy(false);
    setVlcError(null);
  }, [channelName]);

  return (
    <div className="pw-nosignal">
      <div className="pw-nosignal-bars" aria-hidden="true">
        {BARS.map((colour) => (
          <span key={colour} style={{ background: colour }} />
        ))}
      </div>
      <div className="pw-nosignal-title">Channel didn&rsquo;t respond</div>
      <p className="pw-nosignal-detail">
        {channelName ? `${channelName} ` : "This channel "}
        {message ?? "sent no video within 10 seconds. Provider channels drop in and out. It may work on a retry, or another player may handle the stream."}
      </p>
      <div className="pw-nosignal-actions">
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          Try again
        </button>
        {vlcAvailable && (
          <button
            type="button"
            className="btn"
            disabled={vlcBusy}
            onClick={() => {
              setVlcBusy(true);
              setVlcError(null);
              onOpenInVlc()
                .catch((error: unknown) => setVlcError(error instanceof Error ? error.message : "Couldn't open VLC."))
                .finally(() => setVlcBusy(false));
            }}
          >
            {vlcBusy ? "Opening VLC…" : "Open in VLC"}
          </button>
        )}
      </div>
      {vlcError && <p className="msg msg--error">{vlcError}</p>}
    </div>
  );
}
