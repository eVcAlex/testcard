import { render, screen } from "@testing-library/react";
import { Terms } from "./Terms.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

describe("Terms", () => {
  it("states the free beta without promising a price, own-content responsibility, and the contact", () => {
    const { container } = render(<Terms />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms");
    const text = container.textContent ?? "";
    expect(text).toMatch(/The beta is free/);
    expect(text).toMatch(/entitled to use/);
    expect(text).toMatch(/not a registered company/);
    expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(8);
  });
});
