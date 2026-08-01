import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readScrollOffset: vi.fn((_el: HTMLElement | null) => 0),
  scrollFeedToTop: vi.fn(),
}));

vi.mock("../../lib/scroll", () => ({
  readScrollOffset: (el: HTMLElement | null) => mocks.readScrollOffset(el),
  scrollFeedToTop: (el: HTMLElement | null) => mocks.scrollFeedToTop(el),
}));

import { BackToTopButton } from "./BackToTopButton";

describe("BackToTopButton", () => {
  it("is hidden until the active scroller passes the threshold", () => {
    const container = document.createElement("div");
    const containerRef = { current: container };
    mocks.readScrollOffset.mockReturnValue(0);
    render(<BackToTopButton containerRef={containerRef} watchKey="feed:discover" />);
    expect(screen.queryByRole("button", { name: "Scroll to top of feed" })).toBeNull();

    mocks.readScrollOffset.mockReturnValue(700);
    fireEvent.scroll(container);
    expect(screen.getByRole("button", { name: "Scroll to top of feed" })).toBeTruthy();
  });

  it("scrolls the container back to top and hides itself on click", () => {
    const container = document.createElement("div");
    const containerRef = { current: container };
    mocks.readScrollOffset.mockReturnValue(900);
    render(<BackToTopButton containerRef={containerRef} watchKey="feed:discover" />);
    const button = screen.getByRole("button", { name: "Scroll to top of feed" });
    fireEvent.click(button);
    expect(mocks.scrollFeedToTop).toHaveBeenCalledWith(container);
    expect(screen.queryByRole("button", { name: "Scroll to top of feed" })).toBeNull();
  });
});
