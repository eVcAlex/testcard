import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer.tsx";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

describe("Footer", () => {
  it("shows the contact email as a mailto link and the no-channels line", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
    expect(screen.getByText(/ships no channels/i)).toBeInTheDocument();
    expect(screen.getByText(/made by evicted/i)).toBeInTheDocument();
  });

  it("links to the privacy page and the font licence", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: /open font license/i })).toHaveAttribute("href", "/fonts/OFL.txt");
  });

  it("draws the seven bars as decoration only", () => {
    const { container } = render(<Footer />);
    const bars = container.querySelector(".bars");
    expect(bars).toHaveAttribute("aria-hidden", "true");
    expect(bars?.children).toHaveLength(7);
  });
});
