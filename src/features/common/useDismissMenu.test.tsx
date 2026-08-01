import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDismissMenu } from "./useDismissMenu";

function Harness({ onClose, onEscape }: { onClose: () => void; onEscape?: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  useDismissMenu(rootRef, open, () => {
    setOpen(false);
    onClose();
  }, onEscape);
  return (
    <div>
      <div ref={rootRef} data-testid="menu">
        Menu content
      </div>
      <div data-testid="outside">Outside</div>
      <span>{open ? "open" : "closed"}</span>
    </div>
  );
}

describe("useDismissMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("closes on an outside pointer-down", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(screen.getByText("open")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("closed")).toBeTruthy();
  });

  it("does not close on a pointer-down inside the root", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId("menu"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("open")).toBeTruthy();
  });

  it("closes on Escape and runs the onEscape hook", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(<Harness onClose={onClose} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.getByText("closed")).toBeTruthy();
  });

  it("registers listeners only while open", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
    // After close, a further outside click should not re-invoke the callback.
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Harness onClose={onClose} />);
  });
});
