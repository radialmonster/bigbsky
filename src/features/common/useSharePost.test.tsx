import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedPost } from "../../api";
import { useSharePost } from "./useSharePost";

const author = { did: "did:plc:alice", handle: "alice.test", displayName: "Alice" };

function post(uri: string, text: string): FeedPost {
  return { uri, cid: `cid-${uri}`, author, record: { text } } as FeedPost;
}

function Harness({ posts, root }: { posts: FeedPost[]; root: FeedPost }) {
  const { shareState, handleShare } = useSharePost(root, posts);
  return (
    <div>
      <button type="button" onClick={handleShare}>
        Share
      </button>
      <span data-testid="share-state">{shareState}</span>
    </div>
  );
}

function captureShare() {
  let shareImpl: ((data: { title: string; text: string; url: string }) => Promise<void>) | undefined;
  let writeTextImpl: ((url: string) => Promise<void>) | undefined;
  Object.defineProperty(navigator, "share", {
    configurable: true,
    get: () => shareImpl,
    set: (value) => {
      shareImpl = value;
    },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get: () => ({ writeText: writeTextImpl }),
    set: () => undefined,
  });
  const setShare = (impl?: typeof shareImpl) => {
    Object.defineProperty(navigator, "share", { configurable: true, value: impl });
  };
  const setClipboard = (impl: (url: string) => Promise<void>) => {
    writeTextImpl = impl;
  };
  return { setShare, setClipboard };
}

describe("useSharePost", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  });

  it("uses the Web Share API when available and reports shared", async () => {
    const { setShare } = captureShare();
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    const root = post("at://did:plc:alice/app.bsky.feed.post/r1", "Root text");
    render(<Harness root={root} posts={[root]} />);
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(screen.getByTestId("share-state").textContent).toBe("shared"));
    expect(share).toHaveBeenCalledWith({
      title: "Alice on Bluesky",
      text: "Root text",
      url: "https://bsky.app/profile/alice.test/post/r1",
    });
  });

  it("falls back to the clipboard when the Web Share API is unavailable", async () => {
    const { setClipboard } = captureShare();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const root = post("at://did:plc:alice/app.bsky.feed.post/r2", "Copy me");
    render(<Harness root={root} posts={[root]} />);
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(screen.getByTestId("share-state").textContent).toBe("copied"));
    expect(writeText).toHaveBeenCalledWith("https://bsky.app/profile/alice.test/post/r2");
  });

  it("ignores an AbortError from the native share sheet", async () => {
    const { setShare } = captureShare();
    const share = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    setShare(share);
    const root = post("at://did:plc:alice/app.bsky.feed.post/r3", "Text");
    render(<Harness root={root} posts={[root]} />);
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(screen.getByTestId("share-state").textContent).toBe("idle"));
    expect(share).toHaveBeenCalled();
  });

  it("falls back to the clipboard when the native share sheet fails non-abort and reports copied", async () => {
    const { setShare, setClipboard } = captureShare();
    const share = vi.fn().mockRejectedValue(new Error("share unavailable"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    setClipboard(writeText);
    const root = post("at://did:plc:alice/app.bsky.feed.post/r4", "Text");
    render(<Harness root={root} posts={[root]} />);
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(screen.getByTestId("share-state").textContent).toBe("copied"));
    expect(writeText).toHaveBeenCalledWith("https://bsky.app/profile/alice.test/post/r4");
  });

  it("reports an error when both share and clipboard write fail", async () => {
    const { setShare, setClipboard } = captureShare();
    setShare(vi.fn().mockRejectedValue(new Error("share unavailable")));
    setClipboard(vi.fn().mockRejectedValue(new Error("clipboard denied")));
    const root = post("at://did:plc:alice/app.bsky.feed.post/r5", "Text");
    render(<Harness root={root} posts={[root]} />);
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(screen.getByTestId("share-state").textContent).toBe("error"));
  });

  it("joins text across a combined thread with the root url", async () => {
    const { setShare } = captureShare();
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    const root = post("at://did:plc:alice/app.bsky.feed.post/thread1", "First part");
    const second = post("at://did:plc:alice/app.bsky.feed.post/thread2", "Second part");
    render(<Harness root={root} posts={[root, second]} />);
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(screen.getByTestId("share-state").textContent).toBe("shared"));
    expect(share).toHaveBeenCalledWith({
      title: "Alice on Bluesky",
      text: "First part\n\nSecond part",
      url: "https://bsky.app/profile/alice.test/post/thread1",
    });
  });
});
