import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FAQ, GUIDE_CAUSES, faqLdItems } from "../faq-data.ts";
import { faqPageLd } from "../routes-ld.ts";
import { Faq } from "./Faq.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children }: { to: string; hash?: string; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to}>{children}</a>,
}));

describe("Faq", () => {
  it("has ten questions, each a details with an id and an H3 summary", () => {
    const { container } = render(<Faq />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/FAQ/);
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(10);
    for (const d of details) {
      expect(d.id).not.toBe("");
      expect(d.querySelector("summary > h3")).not.toBeNull();
    }
    expect(screen.getByRole("heading", { level: 3, name: "Does Testcard come with channels?" })).toBeInTheDocument();
  });

  it("opens a question on click", async () => {
    const { container } = render(<Faq />);
    const d = container.querySelector<HTMLDetailsElement>("#channels")!;
    expect(d.open).toBe(false);
    await userEvent.setup().click(within(d).getByText("Does Testcard come with channels?"));
    expect(d.open).toBe(true);
  });

  it("answers legality plainly without legal advice, price as free, Windows and Fire TV honestly", () => {
    const { container } = render(<Faq />);
    const text = (id: string) => container.querySelector(`#${id}`)!.textContent ?? "";
    expect(text("legal")).toMatch(/entitled to the content/);
    expect(text("legal")).toMatch(/not legal advice/);
    expect(text("price")).toMatch(/Yes\. Testcard is free/);
    expect(text("windows-warning")).toMatch(/More info.*Run anyway/);
    expect(text("windows-warning")).toMatch(/SHA-256/);
    expect(text("fire-tv")).toMatch(/Downloader code/);
    expect(text("fire-tv")).toMatch(/shared with beta testers/);
  });

  it("lists the concrete causes of an empty or wrong guide", () => {
    const { container } = render(<Faq />);
    const section = container.querySelector("#guide")!;
    expect(within(section as HTMLElement).getByRole("heading", { level: 2, name: "Why is my guide empty or wrong?" })).toBeInTheDocument();
    expect(section.querySelectorAll("li")).toHaveLength(GUIDE_CAUSES.length);
    expect(section.textContent).toMatch(/no XMLTV address/i);
    expect(section.textContent).toMatch(/tvg-id/);
    expect(section.textContent).toMatch(/times are off/i);
    expect(section.textContent).toMatch(/needs a refresh/i);
  });

  it("feeds JSON-LD only timeless answers, and every one is also on the page", () => {
    const items = faqLdItems();
    const names = items.map((i) => i.question);
    expect(names).toEqual(["Does Testcard come with channels?", "Which source types work?", "Why is my guide empty or wrong?"]);
    for (const banned of FAQ.filter((q) => !q.structured)) expect(names).not.toContain(banned.question);
    const doc = faqPageLd(items)[0] as unknown as { mainEntity: unknown[] };
    expect(doc.mainEntity).toHaveLength(4);
    const { container } = render(<Faq />);
    for (const q of items) expect(container.textContent).toContain(q.question);
  });
});
