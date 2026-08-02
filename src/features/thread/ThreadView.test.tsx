import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedPost, Profile, ThreadNode } from "../../api";

const mocks = vi.hoisted(() => ({
  getLikes: vi.fn(),
  getRepostedBy: vi.fn(),
  getQuotes: vi.fn(),
}));

vi.mock("../../api", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getLikes: mocks.getLikes,
    getRepostedBy: mocks.getRepostedBy,
    getQuotes: mocks.getQuotes,
  };
});

import { ThreadView } from "./ThreadView";

const actor = (): Profile => ({
  did: "did:plc:author",
  handle: "author.bsky.social",
  displayName: "Author",
});

const makePost = (overrides: Partial<FeedPost> = {}): FeedPost => ({
  uri: "at://did:plc:author/app.bsky.feed.post/root",
  cid: "cid-root",
  author: actor(),
  record: { text: "hello thread", createdAt: "2026-01-01T00:00:00.000Z" },
  replyCount: 0,
  repostCount: 0,
  likeCount: 0,
  quoteCount: 0,
  ...overrides,
});

const baseProps = {
  currentDid: undefined,
  localLists: [],
  loadingBranches: {} as Record<string, boolean>,
  branchResults: {},
  onOpenImage: vi.fn(),
  onLoadBranch: vi.fn(),
  onOpenPost: vi.fn(),
  onOpenProfile: vi.fn(),
  onToggleListPost: vi.fn(),
  canReply: false,
  onReplied: undefined,
};

const renderThread = (thread: { status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }) =>
  render(<ThreadView thread={thread} {...baseProps} />);

describe("ThreadView unavailable branches (#19 retire threadUnavailableState/thread-alert pins)", () => {
  it.each([
    {
      node: { $type: "app.bsky.feed.defs#blockedPost", message: "blocked by author" },
      tone: "blocked",
      title: "Blocked reply",
    },
    {
      node: { $type: "app.bsky.feed.defs#notFoundPost" },
      tone: "missing",
      title: "Reply not found",
    },
    {
      node: { $type: "app.bsky.feed.defs#tombstone", message: "gone" },
      tone: "deleted",
      title: "Deleted reply",
    },
    {
      node: { $type: "app.bsky.feed.defs#generatorView", message: "rate limited branch" },
      tone: "rate-limit",
      title: "Reply temporarily unavailable",
    },
  ])("renders a $tone alert for a $title", ({ node, tone, title }) => {
    const { container } = renderThread({ status: "ready", node });
    const alert = container.querySelector(`.thread-alert.${tone}`) as HTMLElement;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(title);
  });

  it("falls back to a generic unavailable alert when the branch type is unknown", () => {
    const { container } = renderThread({ status: "ready", node: { $type: "app.bsky.feed.defs#unknown" } });
    const alert = container.querySelector(".thread-alert.unavailable") as HTMLElement;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("Unavailable reply");
  });

  it("renders loading and error states", () => {
    const { container: loading } = renderThread({ status: "loading" });
    expect(loading.querySelector(".state")?.textContent).toContain("Loading thread");
    const { container: error } = renderThread({ status: "error", error: "boom" });
    expect(error.textContent).toContain("boom");
    const { container: none } = renderThread({ status: "ready" });
    expect(none.textContent).toContain("No thread selected.");
  });
});

describe("ThreadView engagement toggle (#19 retire setEngagement pin)", () => {
  beforeEach(() => {
    mocks.getLikes.mockReset().mockResolvedValue({ likes: [], cursor: undefined });
    mocks.getRepostedBy.mockReset().mockResolvedValue({ repostedBy: [], cursor: undefined });
    mocks.getQuotes.mockReset().mockResolvedValue({ posts: [], cursor: undefined });
  });

  it("toggles the on-demand likes panel from the thread stat button", async () => {
    const post = makePost({ likeCount: 5 });
    const { container } = renderThread({ status: "ready", node: { post, replies: [] } });
    const likeButton = [...container.querySelectorAll(".thread-stat-button")].find(
      (button) => button.textContent === "5",
    ) as HTMLButtonElement;
    expect(likeButton).toBeTruthy();
    expect(likeButton.textContent).toContain("5");

    fireEvent.click(likeButton);
    await waitFor(() => expect(container.querySelector(".thread-engagement")).toBeTruthy());
    expect(container.querySelector(".thread-engagement")?.getAttribute("aria-label")).toBe("Liked by");
    expect(mocks.getLikes).toHaveBeenCalled();

    fireEvent.click(likeButton);
    await waitFor(() => expect(container.querySelector(".thread-engagement")).toBeNull());
  });

  it("renders the combined thread card for a multi-part self-thread", async () => {
    const first = makePost({ record: { text: "first segment text", createdAt: "2026-01-01T00:00:00.000Z" } });
    const second = makePost({
      uri: "at://did:plc:author/app.bsky.feed.post/second",
      cid: "cid-second",
      record: {
        text: "second segment text",
        createdAt: "2026-01-01T00:00:01.000Z",
        reply: { root: { uri: first.uri, cid: first.cid }, parent: { uri: first.uri, cid: first.cid } },
      },
    });
    const { container } = renderThread({
      status: "ready",
      node: { post: first, replies: [{ post: second, replies: [] }] },
    });
    await waitFor(() => expect(container.querySelector(".combined-thread-view-card")).toBeTruthy());
    expect(container.querySelectorAll(".combined-thread-segment").length).toBe(2);
    expect(container.textContent).toContain("second segment text");
  });
});
