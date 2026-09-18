import { describe, expect, it } from "vitest";
import { isSafeToSend } from "./safeToSend.js";

describe("isSafeToSend — what the Jev audit is allowed to transmit", () => {
  it("allows ordinary provider category names", () => {
    for (const name of ["UK| SKY SPORTS ⱽᴵᴾ", "|EN| HORROR/THRILLER", "🧸 Kids Channels", "NETFLIX MOVIES DOLBY AUDIO", "US| 24/7 REALITY ᴿᴬᵂ ⁶⁰ᶠᵖˢ"]) {
      expect(isSafeToSend(name)).toBe(true);
    }
  });

  it("refuses anything that looks like a URL, credential or token", () => {
    for (const name of [
      "http://line.example.com:8080/get.php?username=bob&password=hunter2&type=m3u",
      "https://example.com/playlist.m3u8",
      "user@example.com",
      "password=hunter2",
      "username: bob",
      "www.provider.tv Movies",
      "Movies ?token=abcdef123456",
      "0123456789abcdef0123456789abcdef",
      "A".repeat(200),
      "",
    ]) {
      expect(isSafeToSend(name)).toBe(false);
    }
  });
});
