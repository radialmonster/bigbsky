import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FeedPost } from "../../api";
import { useReplyGate } from "./useReplyGate";

function postWith(replyDisabled?: boolean, rkey = "1"): FeedPost {
  return {
    uri: `at://did:plc:abc/app.bsky.feed.post/${rkey}`,
    cid: "cid",
    author: { did: "did:plc:abc", handle: "alice.test" },
    record: {},
    viewer: replyDisabled === undefined ? undefined : { replyDisabled },
  };
}

describe("useReplyGate", () => {
  it("surfaces the limited-replies notice instead of replying when replies are disabled", () => {
    const onReply = vi.fn();
    const { result } = renderHook(() => useReplyGate(postWith(true), onReply));
    expect(result.current.showReplyLimited).toBe(false);
    act(() => result.current.handleReplyClick());
    expect(result.current.showReplyLimited).toBe(true);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("opens the reply flow when replies are permitted", () => {
    const onReply = vi.fn();
    const post = postWith(false);
    const { result } = renderHook(() => useReplyGate(post, onReply));
    act(() => result.current.handleReplyClick());
    expect(result.current.showReplyLimited).toBe(false);
    expect(onReply).toHaveBeenCalledWith(post);
  });

  it("clears a stale limited-notice when the post changes", () => {
    const { result, rerender } = renderHook(({ post }) => useReplyGate(post, undefined), {
      initialProps: { post: postWith(true) },
    });
    act(() => result.current.handleReplyClick());
    expect(result.current.showReplyLimited).toBe(true);
    rerender({ post: postWith(false, "2") });
    expect(result.current.showReplyLimited).toBe(false);
  });
});
