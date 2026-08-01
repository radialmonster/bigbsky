import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaHiddenButton, SensitiveMediaGate } from "./MediaGate";

describe("SensitiveMediaGate", () => {
  it("lists the normalized sensitive labels and reveals on click", () => {
    const onReveal = vi.fn();
    render(<SensitiveMediaGate values={["adult", "graphic"]} onReveal={onReveal} />);
    expect(screen.getByText("Sensitive content")).toBeTruthy();
    expect(screen.getByText("Adult, Graphic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});

describe("MediaHiddenButton", () => {
  it("offers to show hidden image media", () => {
    const onReveal = vi.fn();
    render(<MediaHiddenButton kind="image" onReveal={onReveal} />);
    expect(screen.getByRole("button", { name: "Show hidden image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show hidden image" }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("offers to hide revealed video media", () => {
    const onReveal = vi.fn();
    render(<MediaHiddenButton kind="video" onReveal={onReveal} revealed />);
    expect(screen.getByRole("button", { name: "Hide video" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide video" }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});
