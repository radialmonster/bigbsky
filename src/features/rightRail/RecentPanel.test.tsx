import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentPanel, type RecentItem } from "./RecentPanel";

const items: RecentItem[] = [
  { label: "Discover", path: "/discover", route: { kind: "feed" }, detail: "Discover feed" },
  { label: "Alice", path: "/profile/alice.test", route: { kind: "profile", actor: "alice.test" }, detail: "Profile" },
];

describe("RecentPanel", () => {
  it("returns null when the trail is empty", () => {
    const { container } = render(<RecentPanel items={[]} onOpen={vi.fn()} onClear={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each recent item with its label and detail", () => {
    render(<RecentPanel items={items} onOpen={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Recent" })).toBeTruthy();
    expect(screen.getByText("Discover")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Discover feed")).toBeTruthy();
  });

  it("opens the clicked item", () => {
    const onOpen = vi.fn();
    render(<RecentPanel items={items} onOpen={onOpen} onClear={vi.fn()} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onOpen).toHaveBeenCalledWith(items[1]);
  });

  it("clears the trail via the Clear button", () => {
    const onClear = vi.fn();
    render(<RecentPanel items={items} onOpen={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear recent trail" }));
    expect(onClear).toHaveBeenCalled();
  });
});
