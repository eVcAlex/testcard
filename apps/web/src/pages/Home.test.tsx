import { render, screen, within } from "@testing-library/react";
import { Footer } from "../components/Footer.tsx";
import { WAITLIST_HREF } from "../site.ts";
import { Home } from "./Home.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, hash, children, ...rest }: { to: string; search?: Record<string, string>; hash?: string; children: React.ReactNode }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search)}` : ""}${hash ? `#${hash}` : ""}`} {...rest}>{children}</a>
  ),
}));

describe("Home", () => {
  it("leads with the guide, a waitlist call to action and the setup link", () => {
    render(<><Home /><Footer /></>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Testcard IPTV player · Windows · Fire TV The guide is the page.");
    expect(screen.getAllByRole("link", { name: "Join the beta waitlist" })[0]).toHaveAttribute("href", WAITLIST_HREF);
    expect(screen.getAllByRole("link", { name: "How setup works" })[0]).toHaveAttribute("href", "/setup");
    expect(screen.getByText("Free. We don’t sell channels.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^download/i })).not.toBeInTheDocument();
  });

  it("has the demo at #guide, labelled as invented", () => {
    const { container } = render(<Home />);
    const guide = container.querySelector("#guide")!;
    expect(guide).toHaveAccessibleName(/demo · invented channels, no real streams/i);
    expect(within(guide as HTMLElement).getByRole("listbox", { name: "Channels" })).toBeInTheDocument();
  });

  it("has one section per idea, in order, ending with the waitlist band", () => {
    render(<Home />);
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(["Names, tidied.", "One channel, every feed.", "Films, series and catch-up.", "On the sofa and at the desk.", "Bring your own sources.", "Be there for the beta."]);
  });

  it("says plainly that it ships no channels and points to the FAQ", () => {
    render(<Home />);
    expect(screen.getByText(/ships no channels/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /read the faq/i })).toHaveAttribute("href", "/faq");
  });

  it("shows names as sent beside the tidied ones, and links them to the raw-names demo state", () => {
    render(<Home />);
    const section = screen.getByRole("heading", { name: "Names, tidied." }).closest("section")!;
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
    expect(within(section).getByText("UK| ᴘᴇᴀᴋ ꜱᴘᴏʀᴛ ⁴ᴷ")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /as sent/i })).toHaveAttribute("href", "/?names=raw#guide");
  });

  it("renders real screenshots with their alt text, width, height and lazy loading", () => {
    render(<Home />);
    const movies = screen.getByRole("img", { name: /Movies: poster shelves/i });
    expect(movies).toHaveAttribute("src", "/shots/desktop-movies.webp");
    expect(movies).toHaveAttribute("loading", "lazy");
    expect(movies).toHaveAttribute("width", "1600");
    expect(movies).toHaveAttribute("height", "900");
    expect(screen.getByRole("img", { name: /TV guide on a Fire TV/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Live TV: a category list/i })).toBeInTheDocument();
  });

  it("drops a feed and falls back to the next", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<Home />);
    expect(screen.getByText("Playing the 4K feed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Drop the 4K feed" }));
    expect(screen.getByText("4K dropped. Fell back to FHD automatically.")).toBeInTheDocument();
  });
});
