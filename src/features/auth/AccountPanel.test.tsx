import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthState } from "../../auth";
import { AccountPanel, SignInForm } from "./AccountPanel";

const signedInState: AuthState = {
  status: "signed-in",
  session: {
    did: "did:plc:test",
    handle: "alice.test",
    displayName: "Alice",
    avatar: "https://example.com/alice.jpg",
  },
};

describe("AccountPanel", () => {
  it("shows the signed-in identity with a sign-out action", () => {
    render(<AccountPanel auth={signedInState} onSignIn={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("@alice.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByLabelText("Bluesky handle, DID, or PDS URL")).toBeNull();
  });

  it("renders an avatar image for the signed-in session", () => {
    const { container } = render(<AccountPanel auth={signedInState} onSignIn={vi.fn()} onSignOut={vi.fn()} />);
    expect(container.querySelector("img.avatar")).toBeTruthy();
  });

  it("shows a reader-mode note and the sign-in form when signed out", () => {
    const { rerender } = render(<AccountPanel auth={{ status: "signed-out", session: null }} onSignIn={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByText("Signed-out public reader mode.")).toBeTruthy();
    expect(screen.getByLabelText("Bluesky handle, DID, or PDS URL")).toBeTruthy();

    rerender(<AccountPanel auth={{ status: "checking", session: null }} onSignIn={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByText("Checking browser session.")).toBeTruthy();
  });

  it("marks an error status message with the warning class", () => {
    const { container } = render(
      <AccountPanel auth={{ status: "error", session: null, message: "Could not reach Bluesky." }} onSignIn={vi.fn()} onSignOut={vi.fn()} />,
    );
    expect(screen.getByText("Could not reach Bluesky.")).toBeTruthy();
    expect(container.querySelector("p.account-warning")).toBeTruthy();
  });

  it("calls onSignOut from the sign-out button", () => {
    const onSignOut = vi.fn();
    render(<AccountPanel auth={signedInState} onSignIn={vi.fn()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("passes an entered handle to onSignIn", () => {
    const onSignIn = vi.fn();
    const { container } = render(<AccountPanel auth={{ status: "signed-out", session: null }} onSignIn={onSignIn} onSignOut={vi.fn()} />);
    const input = screen.getByLabelText("Bluesky handle, DID, or PDS URL");
    fireEvent.input(input, { target: { value: "bob.test" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(onSignIn).toHaveBeenCalledWith("bob.test");
  });
});

describe("SignInForm", () => {
  it("submits the entered handle and does not require an account", () => {
    const onSignIn = vi.fn();
    const { container } = render(<SignInForm status="signed-out" onSignIn={onSignIn} />);
    fireEvent.input(screen.getByLabelText("Bluesky handle, DID, or PDS URL"), { target: { value: "carol.test" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(onSignIn).toHaveBeenCalledWith("carol.test");
    expect(screen.getByText(/No account yet\?/)).toBeTruthy();
  });

  it("disables the submit button while a sign-in is in flight", () => {
    const { rerender } = render(<SignInForm status="signing-in" onSignIn={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Working" });
    expect(button).toHaveProperty("disabled", true);

    rerender(<SignInForm status="signed-out" onSignIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty("disabled", false);
  });
});
