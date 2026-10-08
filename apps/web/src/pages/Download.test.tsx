import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Download } from "./Download.tsx";

afterEach(() => vi.restoreAllMocks());

const stub = (yml: Response, json: Response) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("latest.yml") ? yml : json)));
const yml = () => new Response("version: 1.4.2\npath: Testcard-Setup-1.4.2.exe\n", { status: 200 });
const renderPage = (retry: boolean | undefined) =>
  render(
    <QueryClientProvider client={new QueryClient(retry === false ? { defaultOptions: { queries: { retry: false } } } : {})}>
      <Download state="public" />
    </QueryClientProvider>,
  );

it("shows the Windows link and degrades the Fire TV card when one manifest fails", async () => {
  stub(yml(), new Response("boom", { status: 500 }));
  renderPage(false);
  const link = await screen.findByRole("link", { name: "Download for Windows 1.4.2" });
  expect(link.getAttribute("href")).toBe("/app/Testcard-Setup-1.4.2.exe");
  expect(await screen.findByText("Not available right now.")).toBeTruthy();
});

it("shows the Fire TV link when latest.json has an apk", async () => {
  stub(yml(), new Response(JSON.stringify({ apks: { firetv: "testcard-firetv.apk" } }), { status: 200 }));
  renderPage(false);
  const link = await screen.findByRole("link", { name: "Download for Fire TV" });
  expect(link.getAttribute("href")).toBe("/app/testcard-firetv.apk");
});

it("falls back quickly with default retry settings and no invalid-data error", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  stub(yml(), new Response("boom", { status: 500 }));
  renderPage(undefined);
  expect(await screen.findByText("Not available right now.", {}, { timeout: 1000 })).toBeTruthy();
  expect(screen.queryByText("Checking...")).toBeNull();
  expect(err.mock.calls.some((c) => String(c[0]).includes("Query data cannot be undefined"))).toBe(false);
});

it("in the waitlist state offers no download and does not ask for release manifests", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  render(<Download state="waitlist" />);
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /download for/i })).toBeNull();
  expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
  expect(fetchSpy).not.toHaveBeenCalled();
});
