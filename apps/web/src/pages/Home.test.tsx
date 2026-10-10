import { render, screen, within } from "@testing-library/react";
import { Features } from "./Features.tsx";
import { Home } from "./Home.tsx";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => false,
  Link: ({ to, hash, hashScrollIntoView: _h, children, ...rest }: { to: string; hash?: string; hashScrollIntoView?: unknown; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>,
}));

describe("Home", () => {
  it("leads with one H1 and what the product is", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "Testcard IPTV player. Live TV, films & series" })).toBeInTheDocument();
    expect(screen.getByText(/You bring the channels from your provider/)).toBeInTheDocument();
  });

  it("says plainly that channels are the visitor's own", () => {
    render(<Home />);
    expect(screen.getAllByText(/You add your own channels/)[0]).toBeInTheDocument();
  });

  it("has one section per idea, in order", () => {
    render(<Home />);
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(["Your channels, films and series, tidied into one calm place on your computer and your TV.", "On screen.", "Just press play"]);
  });

  it("renders the real screenshots with alt text, dimensions and lazy loading", () => {
    render(<Home />);
    const movies = screen.getByRole("img", { name: /Movies: poster shelves/i });
    expect(movies).toHaveAttribute("src", "/shots/desktop-movies.webp");
    expect(movies).toHaveAttribute("loading", "lazy");
    expect(movies).toHaveAttribute("width", "1600");
    expect(movies).toHaveAttribute("height", "900");
    expect(screen.getByRole("img", { name: /TV guide on a Fire TV/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Live TV: a category list/i })).toBeInTheDocument();
  });

  it("explains tidy names with the messy name, and a readable result for screen readers", () => {
    render(<Home />);
    const card = screen.getByRole("article", { name: "Tidy names" });
    expect(within(card).getByText("UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ")).toBeInTheDocument();
    expect(within(card).getByText("becomes BBC One HD")).toBeInTheDocument();
  });
});

describe("Features", () => {
  it("lists what it does in plain words with real screenshots", () => {
    render(<Features />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What it does.");
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(["Your channels, tidied", "TV guide", "Films & series", "One account", "Keeps playing", "Made for the remote", "Captions your way", "Live TV on your PC"]);
    expect(screen.getByRole("img", { name: /TV guide on a Fire TV/i })).toBeInTheDocument();
  });

  it("enlarges a picture and sets it back", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<Features />);
    const enlarge = screen.getByRole("button", { name: /Enlarge picture: TV guide/ });
    expect(enlarge).toHaveAttribute("aria-pressed", "false");
    await user.click(enlarge);
    expect(screen.getByRole("button", { name: /Smaller picture: TV guide/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("says what is an example", () => {
    render(<Features />);
    expect(screen.getAllByText("Example")).toHaveLength(2);
  });
});
