import type { CatchupProgramme } from "@testcard/core/src/source/xtream/catchup.js";
import type { CatchupGuide } from "../../playback/catchup";

export const two = (n: number) => String(n).padStart(2, "0");

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "13:00" from epoch ms. */
export const clock24 = (ms: number): string => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One line of the Catch up list: what to call the day, the start time and the programme. */
export interface CatchupEntry {
  readonly programme: CatchupProgramme;
  readonly when: string;
  readonly time: string;
}

const hourMinute = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`;

function dayLabel(date: Date, now: Date): string {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : (DAYS[date.getDay()] ?? "");
}

/** What is on now (to start over) comes first, then the past programmes, newest first. */
export function catchupEntries(guide: CatchupGuide): CatchupEntry[] {
  const now = new Date();
  const past = guide.past.map((programme) => ({ programme, when: dayLabel(programme.start, now), time: hourMinute(programme.start) }));
  return guide.current === undefined ? past : [{ programme: guide.current, when: "Start over", time: hourMinute(guide.current.start) }, ...past];
}
