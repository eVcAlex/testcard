import { render, screen, within } from "@testing-library/react";
import { Footer } from "./Footer.tsx";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => false,
  Link: ({ to, hash, hashScrollIntoView: _h, children, ...rest }: { to: string; hash?: string; hashScrollIntoView?: unknown; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>,
}));

describe("Footer", () => {
  it("shows the contact email as a mailto link and the no-channels line", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
    expect(screen.getByText(/ships no channels/i)).toBeInTheDocument();
    expect(screen.getByText(/made by evicted/i)).toBeInTheDocument();
  });

  it("links every page, the waitlist, and the font licence", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/features", "/setup", "/faq", "/download", "/link", "/privacy", "/terms"]);
    expect(screen.getByRole("link", { name: "Join the beta waitlist" })).toHaveAttribute("href", "/download#waitlist");
    expect(screen.getByRole("link", { name: /open font license/i })).toHaveAttribute("href", "/fonts/OFL-PlusJakartaSans.txt");
  });

  it("has the colour theme toggle", () => {
    render(<Footer />);
    expect(screen.getByRole("button", { name: /colour theme/i })).toBeInTheDocument();
  });
});
