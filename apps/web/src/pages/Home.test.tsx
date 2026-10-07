import { render, screen, within } from "@testing-library/react";
import { Footer } from "../Footer.tsx";
import { Home } from "./Home.tsx";

const shots = vi.hoisted(() => ({ list: [] as { src: string; alt: string; caption: string; width: number; height: number }[] }));
vi.mock("../site.ts", () => ({
  CONTACT_EMAIL: "hello@evicted.dev",
  get SHOTS() { return shots.list; },
}));
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a> }));

beforeEach(() => { shots.list = []; });

describe("Home", () => {
  it("leads with what you get, links to download and TV link, and does not pitch dark mode or watermarks", () => {
    const { container } = render(<><Home /><Footer /></>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/live tv, films and series/i);
    expect(screen.getAllByRole("link", { name: /download/i })[0]).toHaveAttribute("href", "/download");
    expect(screen.getAllByRole("link", { name: /link your tv/i })[0]).toHaveAttribute("href", "/link");
    expect(container.textContent).not.toMatch(/dark mode|watermark/i);
  });

  it("says plainly that it brings no channels", () => {
    render(<Home />);
    expect(screen.getByText(/brings no channels/i)).toBeInTheDocument();
  });

  it("states the problem with a fix for each", () => {
    render(<Home />);
    const heading = screen.getByRole("heading", { name: /without the mess/i });
    const section = heading.closest("section")!;
    expect(within(section).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  });

  it("hides the screenshots section when there are none", () => {
    render(<Home />);
    expect(screen.queryByRole("heading", { name: /screenshots|see it/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a lazy image and caption for each screenshot", () => {
    shots.list = [{ src: "/shots/guide.png", alt: "The TV guide grid", caption: "Now and next", width: 1280, height: 720 }];
    render(<Home />);
    expect(screen.getByRole("heading", { name: /see it/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The TV guide grid" })).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Now and next")).toBeInTheDocument();
  });
});
