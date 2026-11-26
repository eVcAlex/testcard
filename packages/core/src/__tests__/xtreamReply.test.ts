import { describe, expect, it } from "vitest";
import { asReplyList } from "../source/xtream/reply.js";

describe("asReplyList", () => {
  it("passes a list through", () => {
    expect(asReplyList<number>([1, 2], "its movies")).toEqual([1, 2]);
  });
  it("reads {} as nothing to list", () => {
    expect(asReplyList({}, "its movies")).toEqual([]);
  });
  it("says in words that it cannot read any other object, with the provider's own words when it gave some", () => {
    expect(() => asReplyList({ foo: 1 }, "its series")).toThrow("The provider sent a reply the app couldn't read for its series.");
    expect(() => asReplyList({ message: " Too many connections " }, "its movies")).toThrow('The provider sent a reply the app couldn\'t read for its movies. It said: "Too many connections".');
  });
  it("reads a refused login as one", () => {
    expect(() => asReplyList({ user_info: { auth: 0 } }, "its movies")).toThrow("The provider rejected the login.");
    expect(() => asReplyList({ user_info: { auth: "0" } }, "its movies")).toThrow("The provider rejected the login.");
  });
  it("never reads a text, a number or nothing as a list", () => {
    for (const reply of ["oops", 3, null, undefined]) expect(() => asReplyList(reply, "its movies")).toThrow("couldn't read for its movies");
  });
});
