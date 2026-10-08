import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joinWaitlist } from "../api.ts";
import { WAITLIST_DONE, WAITLIST_FAILED, WAITLIST_RATE_LIMITED, WaitlistForm } from "./WaitlistForm.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>,
}));

vi.mock("../api.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../api.ts")>()), joinWaitlist: vi.fn() }));
const join = vi.mocked(joinWaitlist);

beforeEach(() => join.mockReset());
afterEach(() => vi.restoreAllMocks());

const fill = async (user: ReturnType<typeof userEvent.setup>, email = "me@example.com") => {
  await user.type(screen.getByLabelText("Email address"), email);
};

describe("WaitlistForm", () => {
  it("has a visible email label, the right input attributes, optional device boxes and a privacy link", () => {
    render(<WaitlistForm />);
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toBeRequired();
    expect(screen.getByRole("checkbox", { name: "Windows" })).not.toBeRequired();
    expect(screen.getByRole("checkbox", { name: "Fire TV" })).not.toBeChecked();
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByText(/we store your email, the devices you ticked and the time/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "hello@evicted.dev" })).toHaveAttribute("href", "mailto:hello@evicted.dev");
  });

  it("hides the honeypot from assistive tech and the tab order", () => {
    const { container } = render(<WaitlistForm />);
    const trap = container.querySelector<HTMLInputElement>('input[name="hp_note"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trap.closest(".wl-hp")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: /leave this field empty/i })).toBeNull();
  });

  it("renders on the server (no hydration-only APIs)", () => {
    expect(renderToString(<WaitlistForm />)).toContain('type="email"');
  });

  it("posts the email and ticked devices, then moves focus to the success message", async () => {
    const user = userEvent.setup();
    join.mockResolvedValue({} as Response);
    render(<WaitlistForm />);
    await fill(user, "  Me@Example.com ");
    await user.click(screen.getByRole("checkbox", { name: "Fire TV" }));
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    expect(join).toHaveBeenCalledWith({ email: "Me@Example.com", windows: false, firetv: true, hp_note: "" });
    const done = await screen.findByRole("status");
    expect(done).toHaveTextContent(WAITLIST_DONE);
    expect(WAITLIST_DONE).toBe("You're on the list. We'll email you when the beta opens. That's the only email we'll send.");
    // Preact runs effects after paint, a moment after the DOM appears.
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.getByRole("link", { name: "privacy policy" })).toBeInTheDocument();
  });

  it("sends whatever a bot typed into the honeypot so the server can drop it", async () => {
    const user = userEvent.setup();
    join.mockResolvedValue({} as Response);
    const { container } = render(<WaitlistForm />);
    await fill(user);
    await user.type(container.querySelector<HTMLInputElement>('input[name="hp_note"]')!, "spam.example");
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    expect(join).toHaveBeenCalledWith(expect.objectContaining({ hp_note: "spam.example" }));
  });

  it("says when there have been too many sign-ups (429) and keeps the form", async () => {
    const user = userEvent.setup();
    join.mockRejectedValue({ status: 429 });
    render(<WaitlistForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many sign-ups from this network today. Try again tomorrow.");
    expect(WAITLIST_RATE_LIMITED).toBe("Too many sign-ups from this network today. Try again tomorrow.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Email address")).toHaveValue("me@example.com");
  });

  it("offers a retry and the email fallback for any other failure, then succeeds on retry", async () => {
    const user = userEvent.setup();
    join.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce({} as Response);
    render(<WaitlistForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(WAITLIST_FAILED);
    expect(WAITLIST_FAILED).toMatch(/hello@evicted\.dev/);
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You're on the list."));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the button while sending and submits once", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    join.mockReturnValue(new Promise<Response>((r) => { release = () => r({} as Response); }));
    render(<WaitlistForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Join the beta waitlist" }));
    expect(screen.getByRole("button", { name: "Joining..." })).toBeDisabled();
    release();
    await screen.findByText(/on the list/);
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("can be submitted with the keyboard alone", async () => {
    const user = userEvent.setup();
    join.mockResolvedValue({} as Response);
    render(<WaitlistForm />);
    await user.tab();
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    await user.keyboard("kb@example.com");
    await user.tab();
    await user.keyboard(" ");
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Join the beta waitlist" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(join).toHaveBeenCalledWith(expect.objectContaining({ email: "kb@example.com", windows: true })));
  });
});
