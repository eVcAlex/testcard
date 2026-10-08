import { render, screen, within } from "@testing-library/react";
import { Setup } from "./Setup.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children }: { to: string; hash?: string; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to}>{children}</a>,
}));

describe("Setup", () => {
  it("is a guide to adding the first source, with id'd H2 sections and a contents list that points at them", () => {
    const { container } = render(<Setup />);
    expect(screen.getByRole("heading", { level: 1, name: "Add your first source" })).toBeInTheDocument();
    const h2 = screen.getAllByRole("heading", { level: 2 });
    expect(h2.length).toBeGreaterThanOrEqual(7);
    for (const h of h2) expect(h.id).not.toBe("");
    const toc = within(screen.getByRole("navigation", { name: "On this page" }));
    for (const a of toc.getAllByRole("link")) expect(container.querySelector(a.getAttribute("href")!)).not.toBeNull();
  });

  it("covers Xtream, M3U, XMLTV, refresh, tidy names, the TV code and profiles using the real field names", () => {
    const { container } = render(<Setup />);
    for (const h of ["Xtream Codes", "M3U playlist"]) expect(screen.getByRole("heading", { level: 3, name: h })).toBeInTheDocument();
    for (const label of ["Server URL", "Username", "Password", "Playlist URL", "XMLTV / EPG URL", "Auto-refresh"]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toMatch(/xmltv\.php/);
    expect(container.textContent).toMatch(/url-tvg/);
    expect(container.textContent).toMatch(/6, 12 or 24 hours/);
    expect(container.textContent).toContain("UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ");
    expect(container.textContent).toContain("BBC One HD");
    expect(container.textContent).toMatch(/up to 4 profiles/i);
    expect(screen.getByRole("link", { name: "evicted.dev/link" })).toHaveAttribute("href", "/link");
    expect(screen.getByText(/source you are entitled to use/)).toBeInTheDocument();
  });
});
