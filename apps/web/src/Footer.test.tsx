import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer.tsx";

describe("Footer", () => {
  it("shows the contact email as a mailto link and the no-channels line", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
    expect(screen.getByText(/brings no channels/i)).toBeInTheDocument();
  });
});
