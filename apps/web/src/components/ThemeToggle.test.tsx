import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./ThemeToggle.tsx";

afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-theme-pref"); document.documentElement.removeAttribute("data-theme"); });

it("is a button that cycles the theme and updates its label", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: false }) as MediaQueryList);
  render(<ThemeToggle />);
  const button = screen.getByRole("button", { name: /colour theme: system/i });
  await userEvent.click(button);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(screen.getByRole("button", { name: /colour theme: light/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button"));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("tc-theme")).toBe("dark");
});
