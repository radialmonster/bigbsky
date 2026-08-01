import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../../api";
import { PinnedProfilesPanel } from "./PinnedProfilesPanel";

const alice: Profile = { did: "did:plc:alice", handle: "alice.test", displayName: "Alice" };
const bob: Profile = { did: "did:plc:bob", handle: "bob.test", displayName: "Bob" };

describe("PinnedProfilesPanel", () => {
  it("returns null when there are no pinned profiles", () => {
    const { container } = render(<PinnedProfilesPanel profiles={[]} onOpen={vi.fn()} onToggle={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each pinned profile's name and handle and opens it on click", () => {
    const onOpen = vi.fn();
    render(<PinnedProfilesPanel profiles={[alice, bob]} onOpen={onOpen} onToggle={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Pinned Profiles" })).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("@bob.test")).toBeTruthy();
    fireEvent.click(screen.getByText("Bob"));
    expect(onOpen).toHaveBeenCalledWith(bob);
  });

  it("unpins a profile via its labeled remove button", () => {
    const onToggle = vi.fn();
    render(<PinnedProfilesPanel profiles={[alice]} onOpen={vi.fn()} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin @alice.test" }));
    expect(onToggle).toHaveBeenCalledWith(alice);
  });
});
