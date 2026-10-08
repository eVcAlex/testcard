import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Download } from "./Download.tsx";

vi.mock("../api.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../api.ts")>()), joinWaitlist: vi.fn() }));

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

describe("Download in the waitlist state", () => {
  it("leads with the form at #waitlist, and explains the beta, requirements and installs", () => {
    const { container } = render(<Download state="waitlist" signed={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/beta/i);
    const waitlist = container.querySelector("#waitlist")!;
    expect(within(waitlist as HTMLElement).getByLabelText("Email address")).toBeInTheDocument();
    for (const h of ["Join the waitlist", "What the beta is", "Requirements", "Windows", "Fire TV", "No channels shipped"]) {
      expect(screen.getByRole("heading", { level: 2, name: h })).toBeInTheDocument();
    }
    expect(screen.getByText(/The beta is free/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent(/Windows 10 or 11, 64-bit \(x64\) only/);
    expect(screen.getByRole("table")).toHaveTextContent(/Fire OS 6 or later \(Android 7\+\) to be confirmed/);
    expect(screen.getByText(/shared with beta testers/)).toBeInTheDocument();
    expect(screen.getByText(/ships no channels/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b[A-Z0-9]{6,7}\b.*downloader code: \d{4,}/i);
  });

  it("explains the SmartScreen warning while the installer is unsigned, and not when it is signed", () => {
    const { rerender } = render(<Download state="waitlist" signed={false} />);
    expect(screen.getByText(/not code-signed yet/)).toHaveTextContent(/More info.*Run anyway/);
    expect(screen.getByText(/not code-signed yet/)).toHaveTextContent(/SHA-256 next to every build/);
    rerender(<Download state="waitlist" signed />);
    expect(screen.queryByText(/not code-signed yet/)).toBeNull();
    expect(screen.getByText(/installer is code-signed/)).toBeInTheDocument();
  });

  it("submits the waitlist form from the page", async () => {
    const { joinWaitlist } = await import("../api.ts");
    vi.mocked(joinWaitlist).mockResolvedValue({} as Response);
    const user = userEvent.setup();
    render(<Download state="waitlist" />);
    await user.type(screen.getByLabelText("Email address"), "a@b.co");
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    expect(await screen.findByRole("status")).toHaveTextContent("You're on the list.");
  });
});

it("in the beta state shows version, file, the published SHA-256 and the SmartScreen note", async () => {
  const hex = "ab".repeat(32);
  stub(new Response(`version: 1.4.2\npath: Testcard-Setup-1.4.2.exe\nsha256: ${hex}\n`, { status: 200 }), new Response(JSON.stringify({ apks: { firetv: "t.apk" } }), { status: 200 }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Download state="beta" signed={false} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(hex)).toBeInTheDocument();
  expect(screen.getByText("Testcard-Setup-1.4.2.exe")).toBeInTheDocument();
  expect(screen.getByText(/More info/)).toBeInTheDocument();
  expect(await screen.findByText(/SHA-256: published next to the file/)).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
});
