import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a> }));

import { ResetPage } from "./ResetPage.tsx";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

const respond = (status: number) => fetchMock.mockResolvedValue(new Response("{}", { status }));

describe("ResetPage", () => {
  it("asks for the email and gives the same answer whatever happens to it", async () => {
    respond(200);
    render(<ResetPage />);
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send me a link" }));
    expect(await screen.findByText(/If that address has a Testcard account/)).toBeInTheDocument();
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/auth/request-password-reset");
    expect(JSON.parse(init.body)).toEqual({ email: "me@example.com", redirectTo: `${location.origin}/reset` });
  });

  it("says so when asked too often, and when the address is plainly not an email", async () => {
    respond(429);
    render(<ResetPage />);
    await userEvent.type(screen.getByLabelText("Email"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Send me a link" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the email address");
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send me a link" }));
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
  });

  it("takes the token out of the address bar and uses it to set the new password", async () => {
    history.replaceState(null, "", "/reset?token=abc123");
    respond(200);
    render(<ResetPage />);
    await userEvent.type(await screen.findByLabelText("New password"), "a-new-password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "a-new-password");
    expect(location.search).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Your password is changed")).toBeInTheDocument();
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/auth/reset-password");
    expect(JSON.parse(init.body)).toEqual({ newPassword: "a-new-password", token: "abc123" });
  });

  it("checks the two passwords before sending anything", async () => {
    history.replaceState(null, "", "/reset?token=abc123");
    render(<ResetPage />);
    await userEvent.type(await screen.findByLabelText("New password"), "a-new-password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "different-one");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("don't match");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains an expired or used link and offers a new one", async () => {
    history.replaceState(null, "", "/reset?error=INVALID_TOKEN");
    render(<ResetPage />);
    expect(await screen.findByText("That link has expired")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Ask for a new one" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
  });

  it("shows the expired message when the server refuses the token", async () => {
    history.replaceState(null, "", "/reset?token=used");
    respond(400);
    render(<ResetPage />);
    await userEvent.type(await screen.findByLabelText("New password"), "a-new-password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "a-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("That link has expired")).toBeInTheDocument();
  });
});
