import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLikes: vi.fn(),
  getRepostedBy: vi.fn(),
  getQuotes: vi.fn(),
  isRateLimit: (error: unknown) => (error as { status?: number } | null)?.status === 429,
  rateLimitMessage: (error: unknown) =>
    (error as { status?: number } | null)?.status === 429
      ? "Bluesky rate limit reached. Pause a moment, then try again."
      : "Network request failed — Bluesky may be rate-limiting or briefly unreachable. Try again.",
}));

vi.mock("../../api", () => ({
  getLikes: (uri: string, limit: number, signal?: AbortSignal, cursor?: string) =>
    mocks.getLikes(uri, limit, signal, cursor),
  getRepostedBy: (uri: string, limit: number, signal?: AbortSignal, cursor?: string) =>
    mocks.getRepostedBy(uri, limit, signal, cursor),
  getQuotes: (uri: string, limit: number, signal?: AbortSignal, cursor?: string) =>
    mocks.getQuotes(uri, limit, signal, cursor),
  isRateLimit: (error: unknown) => mocks.isRateLimit(error),
  rateLimitMessage: (error: unknown) => mocks.rateLimitMessage(error),
}));

import { ThreadEngagementPanel } from "./ThreadEngagementPanel";

const actor = (did: string, handle: string) => ({
  did,
  handle,
  displayName: `Name ${did}`,
  avatar: undefined,
  description: undefined,
});

const post = (uri: string, authorDid: string, text: string) => ({
  uri,
  cid: `cid-${uri}`,
  author: actor(authorDid, `handle-${authorDid}`),
  record: { text },
});

const renderPanel = (overrides?: Partial<React.ComponentProps<typeof ThreadEngagementPanel>>) =>
  render(
    <ThreadEngagementPanel
      uri="at://did:plc:root/app.bsky.feed.post/root"
      kind="likes"
      onOpenProfile={vi.fn()}
      onOpenPost={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );

describe("ThreadEngagementPanel", () => {
  it("renders a loading state then the liked actors when likes are returned", async () => {
    mocks.getLikes.mockResolvedValue({ likes: [{ actor: actor("did:plc:a", "alice.bsky.social") }], cursor: undefined });
    renderPanel();
    expect(screen.getByText("Liked by")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Name did:plc:a")).toBeTruthy());
    expect(screen.getByText("@alice.bsky.social")).toBeTruthy();
    expect(mocks.getLikes).toHaveBeenCalledWith("at://did:plc:root/app.bsky.feed.post/root", 50, expect.any(AbortSignal), undefined);
  });

  it("renders reposted-by actors for the reposts kind", async () => {
    mocks.getRepostedBy.mockResolvedValue({
      repostedBy: [actor("did:plc:b", "bob.bsky.social")],
      cursor: undefined,
    });
    renderPanel({ kind: "reposts" });
    expect(screen.getByText("Reposted by")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Name did:plc:b")).toBeTruthy());
    expect(mocks.getRepostedBy).toHaveBeenCalledWith("at://did:plc:root/app.bsky.feed.post/root", 50, expect.any(AbortSignal), undefined);
  });

  it("renders quote posts for the quotes kind", async () => {
    mocks.getQuotes.mockResolvedValue({
      posts: [post("at://did:plc:root/app.bsky.feed.post/q1", "did:plc:c", "Hello quote")],
      cursor: undefined,
    });
    renderPanel({ kind: "quotes" });
    expect(screen.getByText("Quotes")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Hello quote")).toBeTruthy());
    expect(mocks.getQuotes).toHaveBeenCalledWith("at://did:plc:root/app.bsky.feed.post/root", 30, expect.any(AbortSignal), undefined);
  });

  it("shows an empty state when likes has no actors", async () => {
    mocks.getLikes.mockResolvedValue({ likes: [], cursor: undefined });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Nobody yet")).toBeTruthy());
  });

  it("surfaces a rate-limit state from a 429-style error", async () => {
    mocks.getLikes.mockRejectedValue(Object.assign(new Error("429 Too Many Requests"), { status: 429 }));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText("Bluesky rate limit reached. Pause a moment, then try again.")).toBeTruthy(),
    );
  });

  it("offers a load-more control while a cursor remains and appends the next page", async () => {
    mocks.getLikes
      .mockResolvedValueOnce({
        likes: [{ actor: actor("did:plc:a", "alice.bsky.social") }],
        cursor: "next-cursor",
      })
      .mockResolvedValueOnce({
        likes: [{ actor: actor("did:plc:d", "dave.bsky.social") }],
        cursor: undefined,
      });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Name did:plc:a")).toBeTruthy());
    const loadMore = screen.getByRole("button", { name: "Load more liked by" });
    fireEvent.click(loadMore);
    await waitFor(() => expect(screen.getByText("Name did:plc:d")).toBeTruthy());
    expect(mocks.getLikes).toHaveBeenLastCalledWith(
      "at://did:plc:root/app.bsky.feed.post/root",
      50,
      expect.any(AbortSignal),
      "next-cursor",
    );
  });

  it("keeps the loaded actors and shows the load-more error when a page fails", async () => {
    mocks.getLikes
      .mockResolvedValueOnce({
        likes: [{ actor: actor("did:plc:a", "alice.bsky.social") }],
        cursor: "next-cursor",
      })
      .mockRejectedValueOnce(new Error("network down"));
    renderPanel();
    await waitFor(() => expect(screen.getByText("Name did:plc:a")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Load more liked by" }));
    await waitFor(() => expect(screen.getByText("Couldn't load more right now.")).toBeTruthy());
    expect(screen.getByText("Name did:plc:a")).toBeTruthy();
  });

  it("opens the profile when an actor card is clicked", async () => {
    mocks.getLikes.mockResolvedValue({ likes: [{ actor: actor("did:plc:a", "alice.bsky.social") }], cursor: undefined });
    const onOpenProfile = vi.fn();
    renderPanel({ onOpenProfile });
    await waitFor(() => expect(screen.getByText("Name did:plc:a")).toBeTruthy());
    fireEvent.click(screen.getByText("Name did:plc:a"));
    expect(onOpenProfile).toHaveBeenCalledWith(expect.objectContaining({ did: "did:plc:a" }));
  });

  it("closes the panel when the close button is clicked", async () => {
    mocks.getLikes.mockResolvedValue({ likes: [], cursor: undefined });
    const onClose = vi.fn();
    renderPanel({ onClose });
    await waitFor(() => expect(screen.getByText("Nobody yet")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
