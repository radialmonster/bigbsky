import { describe, expect, it, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { postBskyUrl, safeHttpUrl, postPath, profilePath, handleInternalLinkClick } from "./url";

describe("safeHttpUrl", () => {
  it("returns undefined for empty/nullish input", () => {
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl("")).toBeUndefined();
  });

  it("passes through https URLs, normalized to href", () => {
    expect(safeHttpUrl("https://example.com")).toBe("https://example.com/");
    expect(safeHttpUrl("https://example.com/path?q=1#frag")).toBe(
      "https://example.com/path?q=1#frag",
    );
  });

  it("passes through plain http URLs", () => {
    expect(safeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("rejects non-web schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHttpUrl("file:///etc/passwd")).toBeUndefined();
    expect(safeHttpUrl("mailto:a@b.com")).toBeUndefined();
    expect(safeHttpUrl("at://did:plc:abc/app.bsky.feed.post/1")).toBeUndefined();
    expect(safeHttpUrl("did:plc:abc")).toBeUndefined();
  });

  it("rejects unparseable / relative values", () => {
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl("/relative/path")).toBeUndefined();
    expect(safeHttpUrl("example.com")).toBeUndefined();
  });
});

describe("postBskyUrl", () => {
  it("builds a bsky.app post permalink from the at:// rkey", () => {
    expect(
      postBskyUrl({ uri: "at://did:plc:abc/app.bsky.feed.post/3k2xr", author: { handle: "alice.test" } }),
    ).toBe("https://bsky.app/profile/alice.test/post/3k2xr");
  });

  it("falls back to the profile URL when the record key is missing", () => {
    expect(postBskyUrl({ uri: "at://did:plc:abc/", author: { handle: "alice.test" } })).toBe(
      "https://bsky.app/profile/alice.test",
    );
  });
});

describe("postPath", () => {
  it("builds an in-app profile/post route from the at:// rkey", () => {
    expect(postPath({ uri: "at://did:plc:abc/app.bsky.feed.post/3k2xr", author: { handle: "alice.test" } })).toBe(
      "/profile/alice.test/post/3k2xr",
    );
  });

  it("falls back to null when the record key is missing", () => {
    expect(postPath({ uri: "at://did:plc:abc/", author: { handle: "alice.test" } })).toBeNull();
  });
});

describe("profilePath", () => {
  it("prefers the handle and encodes it", () => {
    expect(profilePath({ handle: "alice.test", did: "did:plc:abc" })).toBe("/profile/alice.test");
  });

  it("falls back to the DID when the handle is missing", () => {
    expect(profilePath({ did: "did:plc:abc" })).toBe("/profile/did%3Aplc%3Aabc");
  });
});

describe("handleInternalLinkClick", () => {
  it("navigates on a plain left-click", () => {
    const navigate = vi.fn();
    const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() } as unknown as ReactMouseEvent<HTMLAnchorElement>;
    handleInternalLinkClick(event, navigate);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
  });

  it("skips navigation for modified-clicks so the browser default survives", () => {
    const navigate = vi.fn();
    const event = { defaultPrevented: false, button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() } as unknown as ReactMouseEvent<HTMLAnchorElement>;
    handleInternalLinkClick(event, navigate);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
