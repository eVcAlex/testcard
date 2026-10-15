import { describe, expect, it } from "vitest";
import { MAX_RECONNECTS, Reconnects, STABLE_MS } from "./health.ts";

describe("Reconnects", () => {
  it("gives up after a few quick losses in a row", () => {
    let t = 0;
    const r = new Reconnects(() => t);
    for (let i = 0; i < MAX_RECONNECTS; i++) {
      r.onPlaying();
      t += 1_000;
      expect(r.take()).toBe(true);
    }
    r.onPlaying();
    expect(r.take()).toBe(false);
  });

  it("starts counting again after a stable run", () => {
    let t = 0;
    const r = new Reconnects(() => t);
    for (let i = 0; i < MAX_RECONNECTS; i++) {
      r.onPlaying();
      r.take();
    }
    r.onPlaying();
    t += STABLE_MS;
    expect(r.take()).toBe(true);
  });
});
