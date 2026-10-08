import { render, screen } from "@testing-library/react";
import { Privacy } from "./Privacy.tsx";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

describe("Privacy", () => {
  it("renders every section and the contact link", () => {
    render(<Privacy />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    for (const h of ["Data on your device", "Provider logins", "Account sync", "Update checks", "This website", "The beta waitlist", "Keeping and deleting your data", "Contact"]) {
      expect(screen.getByRole("heading", { level: 2, name: h })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: "hello@evicted.dev" })[0]).toHaveAttribute("href", "mailto:hello@evicted.dev");
  });

  it("states what the waitlist stores, why, for how long and how to delete it", () => {
    const { container } = render(<Privacy />);
    const section = container.querySelector("#waitlist")!;
    expect(section.textContent).toMatch(/your email address, which devices you ticked .* and the time you signed up/);
    expect(section.textContent).toMatch(/only to email you an invitation/);
    expect(section.textContent).toMatch(/until we have sent your invitation, or until you ask us to delete it/);
    expect(section.textContent).toMatch(/email hello@evicted\.dev/);
  });

  it("covers the theme preference, sync encryption and the update check, and has nothing left to confirm", () => {
    const { container } = render(<Privacy />);
    expect(container.textContent).toMatch(/no cookies and has no analytics/);
    expect(container.textContent).toMatch(/local storage under the name tc-theme/);
    expect(container.textContent).toMatch(/encrypted, with a key derived from your account password/);
    expect(container.textContent).toMatch(/check for new versions/);
    expect(container.textContent).not.toMatch(/Owner to confirm|30 days/i);
    expect(container.textContent).not.toMatch(/placeholder|draft|not yet written/i);
  });
});
