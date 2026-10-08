import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Demo, { TICK_MS } from "./Demo.tsx";

beforeEach(() => {
  // jsdom has no canvas; the preview then simply stays on its CSS pattern.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

const list = () => screen.getByRole("listbox", { name: "Channels" });
const option = (name: RegExp) => screen.getByRole("option", { name });

describe("Demo", () => {
  it("lists channels as a listbox with one tab stop (roving tabindex), not a grid", () => {
    render(<Demo />);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(14);
    expect(options.filter((o) => o.tabIndex === 0)).toHaveLength(1);
    expect(option(/^Harbour News, now:/)).toHaveAttribute("tabindex", "0");
    expect(list()).toBeInTheDocument();
  });

  it("labels each option with now and next, and hides the programme cells from assistive tech", () => {
    render(<Demo />);
    const o = option(/^Peak Sport, now: .* until \d\d:\d\d, next: .*, favourite$/);
    expect(o.querySelector(".dm-cells")).toHaveAttribute("aria-hidden", "true");
  });

  it("arrows move focus between channels, Enter plays, and a live region announces it", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    option(/^Harbour News/).focus();
    await user.keyboard("{ArrowDown}");
    expect(option(/^Tidewater Weather/)).toHaveFocus();
    expect(option(/^Tidewater Weather/)).toHaveAttribute("tabindex", "0");
    expect(option(/^Harbour News/)).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{Enter}");
    expect(option(/^Tidewater Weather/)).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("dm-live")).toHaveTextContent(/^Selected: Tidewater Weather, now:/);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(option(/^Harbour News/)).toHaveFocus();
  });

  it("keeps typing in the search box after Esc was pressed on a row with nothing to clear", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    option(/^Harbour News/).focus();
    await user.keyboard("{Escape}/news");
    expect(screen.getByRole("searchbox", { name: "Search channels" })).toHaveFocus();
    expect(screen.getByRole("searchbox", { name: "Search channels" })).toHaveValue("news");
  });

  it("left and right move between programmes in the row", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    option(/^Harbour News/).focus();
    await user.keyboard("{ArrowRight}");
    expect(option(/^Harbour News/)).toHaveAttribute("data-slot", "1");
    expect(document.getElementById("dm-live")).toHaveTextContent(/^Harbour News, \d\d:\d\d, /);
  });

  it("F toggles the favourite, / focuses the search, T toggles TV mode, Esc clears the search", async () => {
    const user = userEvent.setup();
    const { container } = render(<Demo />);
    option(/^Harbour News/).focus();
    await user.keyboard("f");
    expect(option(/^Harbour News.*favourite$/)).toBeInTheDocument();
    await user.keyboard("t");
    expect(container.querySelector(".demo")).toHaveAttribute("data-mode", "tv");
    expect(screen.getByRole("button", { name: /^TV mode/ })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("t");
    expect(container.querySelector(".demo")).toHaveAttribute("data-mode", "guide");

    await user.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "Search channels" });
    expect(search).toHaveFocus();
    await user.keyboard("ridge");
    expect(search).toHaveValue("ridge");
    expect(screen.getAllByRole("option").length).toBeLessThan(14);
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(14);
    expect(document.activeElement).toHaveAttribute("role", "option");
  });

  it("does not treat typed letters in the search box as shortcuts", async () => {
    const user = userEvent.setup();
    const { container } = render(<Demo />);
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("tf/");
    expect(screen.getByRole("searchbox")).toHaveValue("tf/");
    expect(container.querySelector(".demo")).toHaveAttribute("data-mode", "guide");
  });

  it("shows the No signal state for a search with no match and recovers", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.type(screen.getByRole("searchbox"), "qqqq");
    expect(screen.getByText('No signal on that one. Try "news".')).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    expect(screen.getAllByRole("option")).toHaveLength(14);
  });

  it("categories are a tablist that switches with arrows and the list follows", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    screen.getByRole("tab", { name: /^All/ }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("tab", { name: /^News/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^News/ })).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("ignores keys when focus is outside the demo", async () => {
    const user = userEvent.setup();
    const { container } = render(<><button>outside</button><Demo /></>);
    screen.getByRole("button", { name: "outside" }).focus();
    await user.keyboard("t");
    expect(container.querySelector(".demo")).toHaveAttribute("data-mode", "guide");
  });

  it("shows a keymap legend and the invented-demo label", () => {
    render(<Demo />);
    expect(screen.getByRole("list", { name: "Keyboard shortcuts" })).toHaveTextContent(/Enter play.*F favourite.*\/ search.*Esc clear.*T TV mode/);
    expect(screen.getByText("Demo · invented channels, no real streams")).toBeInTheDocument();
    expect(screen.getByText("Muted preview")).toBeInTheDocument();
  });

  it("reveals every row on 'Show all channels'", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(list()).toHaveAttribute("data-collapsed", "true");
    await user.click(screen.getByRole("button", { name: /show all channels/i }));
    expect(list()).not.toHaveAttribute("data-collapsed");
    expect(screen.queryByRole("button", { name: /show all channels/i })).not.toBeInTheDocument();
  });

  it("raw names button swaps the names for what the source sent", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Raw names" }));
    expect(screen.getAllByText("UK| ᴘᴇᴀᴋ ꜱᴘᴏʀᴛ ⁴ᴷ").length).toBeGreaterThan(0);
  });

  it("starts on raw names when asked", () => {
    render(<Demo initialRaw />);
    expect(screen.getByRole("button", { name: "Raw names" })).toHaveAttribute("aria-pressed", "true");
  });

  describe("clock", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("advances one demo minute every 4 seconds", () => {
      render(<Demo />);
      expect(screen.getByText("20:58")).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(TICK_MS); });
      expect(screen.getByText("20:59")).toBeInTheDocument();
    });

    it("stands still under prefers-reduced-motion", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
      render(<Demo />);
      act(() => { vi.advanceTimersByTime(TICK_MS * 5); });
      expect(screen.getByText("20:58")).toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });
});
