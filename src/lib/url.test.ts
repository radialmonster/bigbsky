import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./url";

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
