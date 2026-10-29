import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a> }));

vi.mock("../link/linkTv.ts", async () => {
  class LinkError extends Error {
    constructor(message: string, readonly field?: string) { super(message); }
  }
  return { LinkError, sendSetupToTv: vi.fn() };
});
vi.mock("@testcard/core/src/sync/linkCrypto.ts", () => ({
  normaliseLinkCode: (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  formatLinkCode: (c: string) => (c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c),
}));

import userEvent from "@testing-library/user-event";
import { LinkError, sendSetupToTv } from "../link/linkTv.ts";
import { SetupLinkPage } from "./SetupLinkPage.tsx";

const ID = "A".repeat(22);
const SECRET = "b".repeat(43);

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("SetupLinkPage", () => {
  it("offers to open the app with the link, and sends nothing anywhere", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState(null, "", `/s#${ID}.${SECRET}`);
    render(<SetupLinkPage />);
    const open = await screen.findByRole("link", { name: "Open in Testcard" });
    expect(open).toHaveAttribute("href", `testcard://s#${ID}.${SECRET}`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Get Testcard" })).toHaveAttribute("href", "/download");
  });

  it("says the link is incomplete when the secret is missing or malformed", async () => {
    history.replaceState(null, "", `/s#${ID}`);
    render(<SetupLinkPage />);
    expect(await screen.findByText("This link is incomplete")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in Testcard" })).toBeNull();
  });

  it("does not turn a hostile fragment into a link", async () => {
    history.replaceState(null, "", `/s#${ID}.${SECRET}"><script>`);
    render(<SetupLinkPage />);
    expect(await screen.findByText("This link is incomplete")).toBeInTheDocument();
  });

  it("sends the link to the TV under the code typed, and says so", async () => {
    history.replaceState(null, "", `/s#${ID}.${SECRET}`);
    vi.mocked(sendSetupToTv).mockResolvedValue(undefined);
    render(<SetupLinkPage />);
    await userEvent.type(await screen.findByLabelText("Code on your TV"), "k7m4qx2p");
    await userEvent.click(screen.getByRole("button", { name: "Send to my TV" }));
    expect(await screen.findByText("Sent to your TV")).toBeInTheDocument();
    expect(sendSetupToTv).toHaveBeenCalledWith({ code: "K7M4-QX2P", fragment: `${ID}.${SECRET}` });
  });

  it("shows why a code was refused and lets the person try again", async () => {
    history.replaceState(null, "", `/s#${ID}.${SECRET}`);
    vi.mocked(sendSetupToTv).mockRejectedValue(new LinkError("That code was not found, or it has expired.", "code"));
    render(<SetupLinkPage />);
    await userEvent.type(await screen.findByLabelText("Code on your TV"), "K7M4QX2P");
    await userEvent.click(screen.getByRole("button", { name: "Send to my TV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not found, or it has expired");
    expect(screen.queryByText("Sent to your TV")).toBeNull();
  });
});
