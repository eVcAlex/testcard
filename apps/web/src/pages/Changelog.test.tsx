import { render, screen } from "@testing-library/react";
import { Changelog } from "./Changelog.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

describe("Changelog", () => {
  it("lists releases newest first and points the Windows beta at the waitlist", () => {
    render(<Changelog />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What's new");
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "join the waitlist" })).toHaveAttribute("href", "/download");
  });
});
