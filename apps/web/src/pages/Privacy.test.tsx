import { render, screen } from "@testing-library/react";
import { Privacy } from "./Privacy.tsx";

it("renders every section, the contact link and the draft note", () => {
  render(<Privacy />);
  expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
  for (const h of ["Data on your device", "Provider logins", "Account sync", "Update checks", "This website", "Retention and legal basis", "Contact"]) {
    expect(screen.getByRole("heading", { level: 2, name: h })).toBeInTheDocument();
  }
  expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
  expect(screen.getByText(/placeholder and will be replaced/i)).toBeInTheDocument();
});
