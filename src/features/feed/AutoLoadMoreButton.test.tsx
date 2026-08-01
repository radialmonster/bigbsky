import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutoLoadMoreButton, PostRowFallback } from "./AutoLoadMoreButton";

describe("AutoLoadMoreButton", () => {
  it("renders the label and fires onLoadMore on an explicit click", () => {
    const onLoadMore = vi.fn();
    render(<AutoLoadMoreButton label="Load more posts" onLoadMore={onLoadMore} />);
    const button = screen.getByRole("button", { name: "Load more posts" });
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not auto-fire onLoadMore on mount (the intersection sentinel must enter the preload margin)", () => {
    const onLoadMore = vi.fn();
    render(<AutoLoadMoreButton label="Load more posts" onLoadMore={onLoadMore} />);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("stops auto-loading after a failed page: surfaces the error and requires an explicit Retry click", () => {
    const onLoadMore = vi.fn();
    render(<AutoLoadMoreButton label="Load more posts" onLoadMore={onLoadMore} error="Rate limited" />);
    expect(screen.getByText("Rate limited")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe("PostRowFallback", () => {
  it("renders a compact alert fallback instead of unmounting the feed", () => {
    render(<PostRowFallback />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("couldn't be rendered");
  });
});
