import { describe, expect, it } from "vitest";
import { asList } from "../source/xtream/asList.js";

describe("asList", () => {
  it("passes a list through", () => {
    expect(asList<number>([1, 2], "get_vod_streams")).toEqual([1, 2]);
    expect(asList<number>([], "get_vod_streams")).toEqual([]);
  });

  it("says what a provider sent instead, by shape and never by value", () => {
    expect(() => asList({ user_info: { auth: 0, password: "secret" }, server_info: {} }, "get_vod_categories")).toThrow(
      "Xtream get_vod_categories: the provider did not send a list (it sent an object with user_info, server_info)",
    );
    try {
      asList({ user_info: { password: "secret" } }, "x");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("handles null, false and an empty object", () => {
    expect(() => asList(null, "a")).toThrow("it sent nothing");
    expect(() => asList(false, "a")).toThrow("it sent boolean false");
    expect(() => asList({}, "a")).toThrow("it sent an empty object");
  });
});
