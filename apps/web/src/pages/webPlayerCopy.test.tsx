import { render, screen, within } from "@testing-library/react";
import { Footer } from "../components/Footer.tsx";
import { Faq } from "./Faq.tsx";

// The switch is on here: the pages then point at /watch, which is a separate page and not a route of this site.
vi.mock("../site.ts", async (original) => ({ ...(await original<typeof import("../site.ts")>()), WEB_PLAYER_LIVE: true }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to} data-router="true">{children}</a>,
}));

describe("with the web player switched on", () => {
  it("answers the phones question with a plain link to /watch, not a router link", () => {
    const { container } = render(<Faq />);
    const phones = container.querySelector<HTMLElement>("#phones")!;
    expect(phones).toHaveTextContent(/iPhone/);
    const link = within(phones).getByRole("link", { name: /on the web/i });
    expect(link).toHaveAttribute("href", "/watch");
    expect(link).not.toHaveAttribute("data-router");
  });

  it("lists the web player in the footer as a plain link", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: "Watch in your browser" });
    expect(link).toHaveAttribute("href", "/watch");
    expect(link).not.toHaveAttribute("data-router");
  });
});
