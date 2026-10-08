import { render } from "@testing-library/react";
import { Head } from "./Head.tsx";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) => select({ location: { pathname: "/", hash: "" } }),
}));

describe("Head", () => {
  afterEach(() => { document.head.innerHTML = ""; });

  it("keeps the prerendered head, JSON-LD included, on first load", () => {
    document.head.innerHTML = '<script type="application/ld+json" data-head>{"@type":"WebSite"}</script>';
    render(<Head />);
    expect(document.head.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  });

  it("builds the head itself when there is none (dev shell)", () => {
    render(<Head />);
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
  });
});
