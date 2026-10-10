import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a> }));
vi.mock("../link/linkTv.ts", async () => {
  class LinkError extends Error {
    constructor(message: string, readonly field?: string, readonly accountCreated = false, readonly switchToSignin = false) { super(message); }
  }
  return { LinkError, linkTv: vi.fn() };
});
vi.mock("@testcard/core/src/sync/linkCrypto.ts", () => ({
  normaliseLinkCode: (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  formatLinkCode: (c: string) => (c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c),
}));

import { LinkError, linkTv } from "../link/linkTv.ts";
import { LinkPage } from "./LinkPage.tsx";

const show = () => render(<QueryClientProvider client={new QueryClient()}><LinkPage /></QueryClientProvider>);

beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState(null, "", "/link");
});

describe("LinkPage", () => {
  it("formats the code as the person types", async () => {
    show();
    await userEvent.type(screen.getByLabelText(/code on your tv/i), "k7m4qx2p");
    expect(screen.getByLabelText(/code on your tv/i)).toHaveValue("K7M4-QX2P");
  });

  it("prefills the code from the URL hash and clears the hash", () => {
    history.replaceState(null, "", "/link#K7M4QX2P");
    show();
    expect(screen.getByLabelText(/code on your tv/i)).toHaveValue("K7M4-QX2P");
    expect(location.hash).toBe("");
  });

  it("shows the error from a failed link and marks the field", async () => {
    vi.mocked(linkTv).mockRejectedValue(new LinkError("That code was not found.", "code"));
    show();
    await userEvent.click(screen.getByRole("button", { name: /link this tv/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code was not found.");
    expect(screen.getByLabelText(/code on your tv/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("create-account tab reveals confirm password and changes the button", async () => {
    show();
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /create account/i }));
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account and link tv/i })).toBeInTheDocument();
  });

  it("switches back to sign-in when the server says the account already exists", async () => {
    vi.mocked(linkTv).mockRejectedValue(new LinkError("There is already an account.", "password", false, true));
    show();
    await userEvent.click(screen.getByRole("tab", { name: /create account/i }));
    await userEvent.click(screen.getByRole("button", { name: /create account and link tv/i }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /sign in/i })).toHaveAttribute("aria-selected", "true"));
    expect(await screen.findByRole("alert")).toHaveTextContent("There is already an account.");
  });

  it("focuses the field the server complained about", async () => {
    vi.mocked(linkTv).mockRejectedValue(new LinkError("That code was not found.", "code"));
    show();
    await userEvent.click(screen.getByRole("button", { name: /link this tv/i }));
    await screen.findByText("That code was not found.");
    expect(screen.getByLabelText(/code on your tv/i)).toHaveFocus();
  });

  it("marks the confirm field when the passwords do not match", async () => {
    vi.mocked(linkTv).mockRejectedValue(new LinkError("Passwords do not match.", "confirm"));
    show();
    await userEvent.click(screen.getByRole("tab", { name: /create account/i }));
    await userEvent.click(screen.getByRole("button", { name: /create account and link tv/i }));
    await screen.findByText("Passwords do not match.");
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the done view on success", async () => {
    vi.mocked(linkTv).mockResolvedValue(undefined);
    show();
    await userEvent.click(screen.getByRole("button", { name: /link this tv/i }));
    expect(await screen.findByRole("heading", { name: /signed in on your tv/i })).toBeInTheDocument();
  });
});
