import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedGeneratorView } from "../../api";

const mocks = vi.hoisted(() => ({
  getActorFeeds: vi.fn(),
  isRateLimit: vi.fn(),
  rateLimitMessage: vi.fn(),
}));

vi.mock("../../api", () => ({
  getActorFeeds: (actor: string, limit: number, signal?: AbortSignal, cursor?: string) =>
    mocks.getActorFeeds(actor, limit, signal, cursor),
  isRateLimit: (error: unknown) => mocks.isRateLimit(error),
  rateLimitMessage: (error: unknown) => mocks.rateLimitMessage(error),
}));

import { ProfileFeedsTab } from "./ProfileFeedsTab";

const feed: FeedGeneratorView = {
  uri: "at://did:plc:actor/app.bsky.feed.generator/posts",
  creator: { did: "did:plc:actor", handle: "actor.test" },
  displayName: "Actor Posts",
  description: "Posts by the actor",
};

describe("ProfileFeedsTab", () => {
  beforeEach(() => {
    mocks.getActorFeeds.mockReset();
    mocks.isRateLimit.mockReset();
    mocks.rateLimitMessage.mockReset();
  });

  it("renders a loading state while the actor's Feeds load", () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorFeeds.mockReturnValue(new Promise(() => {}));
    render(<ProfileFeedsTab actor="did:plc:actor" pinnedFeedIds={[]} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />);
    expect(screen.getByText("Loading Feeds by this account")).toBeTruthy();
  });

  it("renders the actor's published Feeds and opens one in-app", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorFeeds.mockResolvedValue({ feeds: [feed], cursor: undefined });
    const onOpenFeed = vi.fn();
    render(
      <ProfileFeedsTab actor="did:plc:actor" pinnedFeedIds={[]} onOpenFeed={onOpenFeed} onTogglePinnedFeed={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Actor Posts")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Actor Posts/ }));
    expect(onOpenFeed).toHaveBeenCalledTimes(1);
    expect(onOpenFeed.mock.calls[0][0].id).toBe(feed.uri);
  });

  it("marks already-pinned Feeds as pinned", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorFeeds.mockResolvedValue({ feeds: [feed], cursor: undefined });
    render(
      <ProfileFeedsTab actor="did:plc:actor" pinnedFeedIds={[feed.uri]} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Pinned")).toBeTruthy());
  });

  it("loads more Feeds via the cursor when the user clicks Load more", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorFeeds.mockResolvedValueOnce({ feeds: [feed], cursor: "next" });
    mocks.getActorFeeds.mockResolvedValueOnce({
      feeds: [{ ...feed, uri: "at://did:plc:actor/app.bsky.feed.generator/more", displayName: "Second Feed" }],
      cursor: undefined,
    });
    render(<ProfileFeedsTab actor="did:plc:actor" pinnedFeedIds={[]} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more Feeds" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Load more Feeds" }));
    await waitFor(() => expect(screen.getByText("Second Feed")).toBeTruthy());
    expect(mocks.getActorFeeds).toHaveBeenLastCalledWith("did:plc:actor", 50, expect.anything(), "next");
  });

  it("renders an empty state when the actor has published no Feeds", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorFeeds.mockResolvedValue({ feeds: [], cursor: undefined });
    render(<ProfileFeedsTab actor="did:plc:actor" pinnedFeedIds={[]} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No Feeds")).toBeTruthy());
  });

  it("renders a rate-limit state when the endpoint returns 429", async () => {
    mocks.isRateLimit.mockReturnValue(true);
    mocks.rateLimitMessage.mockReturnValue("Bluesky rate limit reached.");
    mocks.getActorFeeds.mockRejectedValue(new Error("429"));
    render(<ProfileFeedsTab actor="did:plc:actor" pinnedFeedIds={[]} onOpenFeed={vi.fn()} onTogglePinnedFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Bluesky rate limit reached.")).toBeTruthy());
  });
});
