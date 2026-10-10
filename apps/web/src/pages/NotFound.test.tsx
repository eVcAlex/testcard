import { render, screen } from "@testing-library/react";
import { NotFound } from "./NotFound.tsx";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

it("says no signal and links home", () => {
  render(<NotFound />);
  expect(screen.getByRole("heading", { level: 1, name: "No signal" })).toBeInTheDocument();
  expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/");
});
