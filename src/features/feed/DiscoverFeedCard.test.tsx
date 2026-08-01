import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FeedGeneratorView } from "../../api";
import type { FeedSource } from "../../sources";
import { DiscoverFeedCard } from "./DiscoverFeedCard";

const feed: FeedGeneratorView = {
  uri: "at://did:plc:feed1/app.bsky.feed.generator/feed1",
  creator: { did: "did:plc:feed1", handle: "feed1.test" },
  displayName: "The Feed",
  description: "A public feed",
  likeCount: 250,
};

describe("DiscoverFeedCard", () => {
  it("renders the feed name, creator, description, and likes", () => {
    render(<DiscoverFeedCard feed={feed} isPinned={false} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />);
    expect(screen.getByText("The Feed")).toBeTruthy();
    expect(screen.getByText("by @feed1.test")).toBeTruthy();
    expect(screen.getByText("A public feed")).toBeTruthy();
    expect(screen.getByText("250 likes")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open on Bluesky" })).toBeTruthy();
  });

  it("opens the feed as a discovered source on click", () => {
    const onOpenFeed = vi.fn();
    render(<DiscoverFeedCard feed={feed} isPinned={false} onOpenFeed={onOpenFeed} onTogglePinnedFeed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^The Feed/ }));
    const source: FeedSource = onOpenFeed.mock.calls[0][0];
    expect(source.id).toBe(feed.uri);
    expect(source.group).toBe("Discovered");
  });

  it("toggles the local pin", () => {
    const onTogglePinnedFeed = vi.fn();
    const { rerender } = render(
      <DiscoverFeedCard feed={feed} isPinned={false} onOpenFeed={vi.fn()} onTogglePinnedFeed={onTogglePinnedFeed} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin The Feed" }));
    expect(onTogglePinnedFeed).toHaveBeenCalled();
    rerender(<DiscoverFeedCard feed={feed} isPinned onOpenFeed={vi.fn()} onTogglePinnedFeed={onTogglePinnedFeed} />);
    expect(screen.getByRole("button", { name: "Unpin The Feed" })).toBeTruthy();
  });

  it("shows follow controls only when follow is supported", () => {
    const onToggleFollow = vi.fn();
    render(
      <DiscoverFeedCard
        feed={feed}
        isPinned={false}
        onOpenFeed={vi.fn()}
        onTogglePinnedFeed={vi.fn()}
        canFollow
        onToggleFollow={onToggleFollow}
      />,
    );
    expect(screen.getByRole("button", { name: "Follow The Feed" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Follow The Feed" }));
    expect(onToggleFollow).toHaveBeenCalledWith(feed.uri, "The Feed");
  });

  it("renders a glyph placeholder when the feed has no avatar", () => {
    const { container } = render(
      <DiscoverFeedCard feed={feed} isPinned={false} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />,
    );
    expect(container.querySelector("img.discover-feed-avatar")).toBeNull();
    expect(container.querySelector("span.discover-feed-glyph")).toBeTruthy();
  });
});
