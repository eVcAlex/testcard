import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header, TopBar } from "./Header.tsx";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => false,
  Link: ({ to, hash, hashScrollIntoView: _h, activeOptions: _a, children, ...rest }: { to: string; hash?: string; hashScrollIntoView?: unknown; activeOptions?: unknown; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>,
}));

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
});

describe("Header (the pill)", () => {
  it("links the pages, Link your TV, and offers the beta as the main action", () => {
    render(<Header />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Home", "Features", "Setup", "FAQ", "Link your TV", "Join the beta"]);
    expect(within(nav).getByRole("link", { name: "Join the beta" })).toHaveAttribute("href", "/download#waitlist");
    expect(within(nav).getByRole("link", { name: "Link your TV" })).toHaveAttribute("href", "/link");
  });

  it("folds into a Menu button that opens the links and closes on Escape", async () => {
    render(<Header />);
    const opener = screen.getByRole("button", { name: "Menu" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(opener).toHaveTextContent("Close");
    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveAttribute("aria-expanded", "false");
  });
});

describe("TopBar", () => {
  it("has the wordmark home link and the contact address", () => {
    render(<TopBar />);
    expect(screen.getByRole("link", { name: "Testcard home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
  });
});
