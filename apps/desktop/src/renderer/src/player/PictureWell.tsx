import { useEffect, useRef } from "react";

/**
 * The picture well: a true-black rectangle that the mpv video window is positioned over
 * (mpv renders into a separate frameless window — see ADR 0001 — so nothing here is ever
 * drawn "on" the video). This component's job is to keep the main process told where the
 * well is on screen, in CSS pixels, so that window can track it.
 */
export function PictureWell({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        void window.testcard.playback.setVideoRegion({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener("resize", report);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, []);

  return (
    <div className="pw-well" ref={ref}>
      {children}
    </div>
  );
}
