import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "./Header.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>,
}));

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
});

describe("Header", () => {
  it("has the wordmark, the four nav links, Link TV, the join button and the theme toggle", () => {
    render(<Header />);
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(Array.from(main.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Guide", "Setup", "FAQ", "Download"]);
    expect(screen.getByRole("link", { name: "Testcard home" }).querySelector("b")).toHaveTextContent("card");
    expect(screen.getAllByRole("link", { name: "Join the beta" })[0]).toHaveAttribute("href", "/download#waitlist");
    expect(screen.getAllByRole("link", { name: "Link TV" })[0]).toHaveAttribute("href", "/link");
    expect(screen.getByRole("button", { name: /colour theme/i })).toBeInTheDocument();
  });

  it("opens the menu as a dialog from a labelled button and closes it from the close button", async () => {
    render(<Header />);
    const opener = screen.getByRole("button", { name: "Menu" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(opener).toHaveAttribute("aria-expanded", "false");
  });
});
