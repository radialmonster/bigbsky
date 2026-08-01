import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RichTextFacet } from "../../api";
import { renderRichText } from "./RichText";

function linkFacet(byteStart: number, byteEnd: number, uri: string): RichTextFacet {
  return { index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] };
}

function mentionFacet(byteStart: number, byteEnd: number, did: string): RichTextFacet {
  return { index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#mention", did }] };
}

function tagFacet(byteStart: number, byteEnd: number, tag: string): RichTextFacet {
  return { index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#tag", tag }] };
}

describe("renderRichText", () => {
  it("passes plain text through without wrapping", () => {
    expect(renderRichText("", undefined)).toBe("");
    expect(renderRichText("just words", undefined)).toBe("just words");
  });

  it("renders a link facet as an external anchor and stops propagation on click", () => {
    const text = "see https://example.com now";
    const container = document.createElement("div");
    const { container: rendered } = render(
      renderRichText(text, [linkFacet(4, 23, "https://example.com")]),
      { container },
    );
    const link = rendered.querySelector("a.post-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.textContent).toBe("https://example.com");
    expect(link.href).toBe("https://example.com/");
    expect(link.target).toBe("_blank");
  });

  it("renders a mention facet as a button that opens the profile", () => {
    const text = "@alice.test";
    const onOpenProfile = vi.fn();
    render(renderRichText(text, [mentionFacet(0, 11, "did:plc:alice")], onOpenProfile));
    const button = screen.getByRole("button", { name: "@alice.test" });
    fireEvent.click(button);
    expect(onOpenProfile).toHaveBeenCalledWith({ did: "did:plc:alice", handle: "alice.test" });
  });

  it("renders a tag facet as a button that opens an in-app tag search", () => {
    const text = "#BlueSky";
    const onOpenTag = vi.fn();
    render(renderRichText(text, [tagFacet(0, 8, "BlueSky")], undefined, onOpenTag));
    const button = screen.getByRole("button", { name: "#BlueSky" });
    fireEvent.click(button);
    expect(onOpenTag).toHaveBeenCalledWith("BlueSky");
  });

  it("drops link facets whose uri is not a safe http(s) URL back to plain text", () => {
    const text = "bad javascript:alert(1) link";
    render(renderRichText(text, [linkFacet(4, 20, "javascript:alert(1)")]));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("bad javascript:alert(1) link")).toBeTruthy();
  });
});
