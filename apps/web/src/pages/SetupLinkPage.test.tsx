import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a> }));

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
});
