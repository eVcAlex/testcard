import { useEffect, useRef } from "react";
import type { Channel } from "./data.ts";
import { drawNoise, drawPattern } from "./pattern.ts";

/** Draws the channel's test pattern. Changing channel (and the first load) shows static first. Runs after mount only. */
export function PreviewCanvas({ channel, firstTuneMs, tuneMs }: { channel: Channel; firstTuneMs: number; tuneMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const ms = first.current ? firstTuneMs : tuneMs;
    first.current = false;
    if (ms <= 0) {
      drawPattern(ctx, channel);
      return;
    }
    let frame = 0;
    drawNoise(ctx, channel.id, frame++);
    const noise = setInterval(() => drawNoise(ctx, channel.id, frame++), 70);
    const done = setTimeout(() => {
      clearInterval(noise);
      drawPattern(ctx, channel);
    }, ms);
    return () => { clearInterval(noise); clearTimeout(done); };
  }, [channel, firstTuneMs, tuneMs]);
  return <canvas ref={ref} className="dm-canvas" width={640} height={360} role="img" aria-label="Test pattern standing in for the picture" />;
}
