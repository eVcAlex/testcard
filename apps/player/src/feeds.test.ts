import { describe, expect, it } from "vitest";
import { feedsFor, fellBackNote, toChannel } from "./feeds.ts";
import { FeedHealth, BUFFER_FAILOVER_MS, START_WITHIN_MS } from "./health.ts";

const ch = (id: string, name: string) => toChannel({ id, name, categoryId: "1", logo: undefined }, [`http://x/${id}.m3u8`]);

describe("feedsFor", () => {
  const pool = [ch("1", "UK: BBC One 4K"), ch("2", "UK: BBC One HD"), ch("3", "UK: BBC One SD"), ch("4", "UK: BBC Two HD"), ch("5", "UK: BBC One")];
  it("tries the channel, then the same channel in other qualities, HD first and 4K last", () => {
    expect(feedsFor(pool[0]!, pool).map((c) => c.id)).toEqual(["1", "2", "5", "3"]);
    expect(feedsFor(pool[2]!, pool).map((c) => c.id)).toEqual(["3", "2", "5", "1"]);
  });
  it("never offers another channel, or the same one twice", () => {
    const ids = feedsFor(pool[1]!, pool).map((c) => c.id);
    expect(ids).not.toContain("4");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("says what took over", () => {
    expect(fellBackNote(pool[0]!, pool[1]!)).toBe("Playing BBC One HD instead");
  });
});

describe("FeedHealth", () => {
  let clock = 1_000;
  const health = (moreFeeds = true, switchOn = true) => new FeedHealth(() => clock, moreFeeds, switchOn);

  it("moves on from a feed that errors, only while another is left", () => {
    expect(health().onError()).toBe("failover");
    expect(health(false).onError()).toBeNull();
  });
  it("moves on from a feed that never starts", () => {
    const h = health();
    clock += START_WITHIN_MS - 100;
    expect(h.tick()).toBeNull();
    clock += 200;
    expect(h.tick()).toBe("failover");
  });
  it("moves on once a playing picture has buffered for a moment, not for a blip", () => {
    const h = health();
    h.onPlaying();
    h.onWaiting();
    clock += BUFFER_FAILOVER_MS - 100;
    expect(h.tick()).toBeNull();
    h.onPlaying();
    clock += 10_000;
    expect(h.tick()).toBeNull();
    h.onWaiting();
    clock += BUFFER_FAILOVER_MS;
    expect(h.tick()).toBe("failover");
  });
  it("leaves a buffering picture alone when the switch is off", () => {
    const h = health(true, false);
    h.onPlaying();
    h.onWaiting();
    clock += 60_000;
    expect(h.tick()).toBeNull();
  });
});
