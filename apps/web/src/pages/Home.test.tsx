import { render, screen, within } from "@testing-library/react";
import { Footer } from "../components/Footer.tsx";
import { Home } from "./Home.tsx";

const shots = vi.hoisted(() => ({ list: [] as { src: string; alt: string; caption: string; width: number; height: number }[] }));
vi.mock("../site.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../site.ts")>()),
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
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    items.forEach((li) => expect(li.children).toHaveLength(2));
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
    expect(screen.getByRole("figure")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The TV guide grid" })).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Now and next")).toBeInTheDocument();
  });

  it("has an Everything else section whose cards do not repeat the problem list", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 2, name: "Everything else" })).toBeInTheDocument();
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(titles.length).toBe(6);
    titles.forEach((t) => expect(t).not.toMatch(/tidy names|real tv guide|picks up where/i));
  });
});
