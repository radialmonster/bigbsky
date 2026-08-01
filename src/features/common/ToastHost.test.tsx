import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastHost, type ToastMessage } from "./ToastHost";

describe("ToastHost", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = render(<ToastHost toasts={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders error toasts with role=alert and info toasts with role=status", () => {
    const toasts: ToastMessage[] = [
      { id: 1, kind: "error", message: "Couldn't save" },
      { id: 2, kind: "info", message: "Feed pinned" },
    ];
    render(<ToastHost toasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
    expect(screen.getByRole("status").textContent).toContain("Feed pinned");
  });

  it("dismisses a toast on the dismiss button click", () => {
    const onDismiss = vi.fn();
    const toasts: ToastMessage[] = [{ id: 7, kind: "success", message: "Saved" }];
    render(<ToastHost toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledWith(7);
  });
});
