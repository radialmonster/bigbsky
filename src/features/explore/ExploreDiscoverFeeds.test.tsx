import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedGeneratorView } from "../../api";

const mocks = vi.hoisted(() => ({
  getPopularFeedGenerators: vi.fn(),
}));

vi.mock("../../api", () => ({
  getPopularFeedGenerators: (limit: number, signal?: AbortSignal, query?: string) =>
    mocks.getPopularFeedGenerators(limit, signal, query),
}));

import { ExploreDiscoverFeeds } from "./ExploreDiscoverFeeds";

const feed: FeedGeneratorView = {
  uri: "at://did:plc:discover/app.bsky.feed.generator/discover",
  creator: { did: "did:plc:discover", handle: "discover.test" },
  displayName: "A Discover Feed",
  description: "A popular public feed",
};

describe("ExploreDiscoverFeeds", () => {
  beforeEach(() => {
    mocks.getPopularFeedGenerators.mockReset();
  });

  it("renders a loading state while the live fetch is in flight", () => {
    mocks.getPopularFeedGenerators.mockReturnValue(new Promise(() => {}));
    render(
      <ExploreDiscoverFeeds
        onOpenFeed={vi.fn()}
        pinnedFeedIds={[]}
        onTogglePinnedFeed={vi.fn()}
        canFollowFeeds={false}
        followedFeedUris={new Set()}
        followBusyUri={null}
        onToggleFollowFeed={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading popular Feeds")).toBeTruthy();
  });

  it("renders live popular feeds and opens one as an in-app discovered source", async () => {
    mocks.getPopularFeedGenerators.mockResolvedValue({ feeds: [feed] });
    const onOpenFeed = vi.fn();
    render(
      <ExploreDiscoverFeeds
        onOpenFeed={onOpenFeed}
        pinnedFeedIds={[]}
        onTogglePinnedFeed={vi.fn()}
        canFollowFeeds={false}
        followedFeedUris={new Set()}
        followBusyUri={null}
        onToggleFollowFeed={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("A Discover Feed")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^A Discover Feed/ }));
    const source = onOpenFeed.mock.calls[0][0];
    expect(source.id).toBe(feed.uri);
    expect(source.group).toBe("Discovered");
  });

  it("refetches only on explicit search submit, not per keystroke", async () => {
    mocks.getPopularFeedGenerators.mockResolvedValue({ feeds: [feed] });
    render(
      <ExploreDiscoverFeeds
        onOpenFeed={vi.fn()}
        pinnedFeedIds={[]}
        onTogglePinnedFeed={vi.fn()}
        canFollowFeeds={false}
        followedFeedUris={new Set()}
        followBusyUri={null}
        onToggleFollowFeed={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.getPopularFeedGenerators).toHaveBeenCalledTimes(1));
    const input = screen.getByLabelText("Search public Feeds");
    fireEvent.input(input, { target: { value: "atproto" } });
    expect(mocks.getPopularFeedGenerators).toHaveBeenCalledTimes(1);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(mocks.getPopularFeedGenerators).toHaveBeenCalledTimes(2));
    expect(mocks.getPopularFeedGenerators).toHaveBeenLastCalledWith(18, expect.anything(), "atproto");
  });

  it("renders an empty state when the live fetch returns no feeds", async () => {
    mocks.getPopularFeedGenerators.mockResolvedValue({ feeds: [] });
    render(
      <ExploreDiscoverFeeds
        onOpenFeed={vi.fn()}
        pinnedFeedIds={[]}
        onTogglePinnedFeed={vi.fn()}
        canFollowFeeds={false}
        followedFeedUris={new Set()}
        followBusyUri={null}
        onToggleFollowFeed={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("No Feeds found")).toBeTruthy());
  });

  it("renders an error state when the live fetch fails", async () => {
    mocks.getPopularFeedGenerators.mockRejectedValue(new Error("rate limited"));
    render(
      <ExploreDiscoverFeeds
        onOpenFeed={vi.fn()}
        pinnedFeedIds={[]}
        onTogglePinnedFeed={vi.fn()}
        canFollowFeeds={false}
        followedFeedUris={new Set()}
        followBusyUri={null}
        onToggleFollowFeed={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("Popular Feeds could not be loaded right now.")).toBeTruthy());
  });
});
