import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Download } from "./Download.tsx";

afterEach(() => vi.unstubAllGlobals());

it("shows the Windows link and degrades the Fire TV card when one manifest fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).endsWith("latest.yml")
      ? new Response("version: 1.4.2\npath: Testcard-Setup-1.4.2.exe\n", { status: 200 })
      : new Response("boom", { status: 500 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Download />
    </QueryClientProvider>,
  );
  const link = await screen.findByRole("link", { name: "Download for Windows 1.4.2" });
  expect(link.getAttribute("href")).toBe("/app/Testcard-Setup-1.4.2.exe");
  expect(await screen.findByText("Not available right now.")).toBeTruthy();
});
