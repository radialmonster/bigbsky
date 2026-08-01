import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PinnedSearchesPanel } from "./PinnedSearchesPanel";

describe("PinnedSearchesPanel", () => {
  it("returns null when there are no pinned searches", () => {
    const { container } = render(<PinnedSearchesPanel searches={[]} onOpen={vi.fn()} onToggle={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each pinned search and opens it on click", () => {
    const onOpen = vi.fn();
    render(<PinnedSearchesPanel searches={["bluesky", "atproto"]} onOpen={onOpen} onToggle={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Pinned Searches" })).toBeTruthy();
    fireEvent.click(screen.getByText("bluesky"));
    expect(onOpen).toHaveBeenCalledWith("bluesky");
  });

  it("unpins a search via its labeled remove button", () => {
    const onToggle = vi.fn();
    render(<PinnedSearchesPanel searches={["bluesky"]} onOpen={vi.fn()} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin bluesky" }));
    expect(onToggle).toHaveBeenCalledWith("bluesky");
  });
});
