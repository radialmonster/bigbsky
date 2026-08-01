import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../../api";
import { ProfileDetailHeader } from "./ProfileDetailHeader";

const alice: Profile = {
  did: "did:plc:alice",
  handle: "alice.test",
  displayName: "Alice",
  avatar: "https://cdn.test/avatar.jpg",
  description: "Hello world",
  followersCount: 10,
  followsCount: 20,
  postsCount: 30,
};

function renderHeader(overrides: Partial<ComponentProps<typeof ProfileDetailHeader>> = {}) {
  const props: ComponentProps<typeof ProfileDetailHeader> = {
    actor: "alice.test",
    isPinned: false,
    profile: alice,
    selectedTab: "posts",
    onSelectTab: vi.fn(),
    onTogglePinned: vi.fn(),
    canFollow: false,
    onFollow: vi.fn(),
    onUnfollow: vi.fn(),
    onBlock: vi.fn(),
    onUnblock: vi.fn(),
    canPost: false,
    ...overrides,
  };
  return render(<ProfileDetailHeader {...props} />);
}

describe("ProfileDetailHeader", () => {
  it("renders the profile name, handle, description, and stats", () => {
    const { container } = renderHeader();
    expect(screen.getByRole("heading", { name: "Alice" })).toBeTruthy();
    expect(screen.getByText("@alice.test")).toBeTruthy();
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(container.querySelector("img.avatar")).toBeTruthy();
  });

  it("renders the Feeds and Lists tabs for public profiles", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "feeds" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "lists" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New post" })).toBeNull();
  });

  it("adds a New post tab when the viewer can post", () => {
    renderHeader({ canPost: true });
    expect(screen.getByRole("button", { name: "New post" })).toBeTruthy();
  });

  it("selects a tab on click", () => {
    const onSelectTab = vi.fn();
    renderHeader({ onSelectTab });
    fireEvent.click(screen.getByRole("button", { name: "feeds" }));
    expect(onSelectTab).toHaveBeenCalledWith("feeds");
  });

  it("toggles the local pin", () => {
    const onTogglePinned = vi.fn();
    renderHeader({ onTogglePinned });
    fireEvent.click(screen.getByRole("button", { name: "Pin locally" }));
    expect(onTogglePinned).toHaveBeenCalledWith(alice);
  });

  it("follows and unfollows through the viewer-state button", async () => {
    const onFollow = vi.fn().mockResolvedValue("at://app.bsky.graph.follow/1");
    const onUnfollow = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHeader({ canFollow: true, onFollow, onUnfollow });
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(await screen.findByRole("button", { name: "Following" })).toBeTruthy();
    expect(onFollow).toHaveBeenCalledWith("did:plc:alice");

    const followingProfile = { ...alice, viewer: { following: "at://app.bsky.graph.follow/1" } };
    rerender(
      <ProfileDetailHeader
        actor="alice.test"
        isPinned={false}
        profile={followingProfile}
        selectedTab="posts"
        onSelectTab={vi.fn()}
        onTogglePinned={vi.fn()}
        canFollow
        onFollow={onFollow}
        onUnfollow={onUnfollow}
        onBlock={vi.fn()}
        onUnblock={vi.fn()}
        canPost={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Following" }));
    expect(onUnfollow).toHaveBeenCalledWith("at://app.bsky.graph.follow/1");
    await screen.findByRole("button", { name: "Follow" });
  });
});
