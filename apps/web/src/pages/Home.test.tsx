import { render, screen } from "@testing-library/react";
import { Home } from "./Home.tsx";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a> }));

describe("Home", () => {
  it("leads with what you get, links to download and TV link, and does not pitch dark mode or watermarks", () => {
    const { container } = render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/live tv, films and series/i);
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("href", "/download");
    expect(screen.getByRole("link", { name: /link your tv/i })).toHaveAttribute("href", "/link");
    expect(container.textContent).not.toMatch(/dark mode|watermark/i);
  });

  it("says plainly that it brings no channels", () => {
    render(<Home />);
    expect(screen.getByText(/brings no channels/i)).toBeInTheDocument();
  });
});
