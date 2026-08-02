import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem, FeedPost, Profile } from "../../api";
import { DensityContext } from "../post/PostCardContexts";
import { ShowMediaContext, ShowNsfwContext } from "../common/useMediaReveal";
import { MeasuredPostRow, VirtualPostList } from "./VirtualPostList";

const author = (): Profile => ({
  did: "did:plc:author",
  handle: "author.bsky.social",
  displayName: "Author",
  labels: [],
});

const makePost = (uri: string): FeedPost => ({
  uri,
  cid: `cid-${uri}`,
  author: author(),
  record: { text: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
});

const makeItems = (count: number): FeedItem[] =>
  Array.from({ length: count }, (_, index) => ({ post: makePost(`at://did:plc:author/app.bsky.feed.post/${index}`) }));

const renderList = (items: FeedItem[], onRenderedRowsChange = vi.fn()) => {
  const scrollContainer = document.createElement("div");
  const containerRef = { current: scrollContainer };
  const view = render(
    <ShowNsfwContext.Provider value={false}>
      <ShowMediaContext.Provider value={true}>
        <DensityContext.Provider value="compact">
          <VirtualPostList
            containerRef={containerRef as React.RefObject<HTMLDivElement | null>}
            density="compact"
            items={items}
            localLists={[]}
            onOpenImage={vi.fn()}
            onOpenPost={vi.fn()}
            onOpenProfile={vi.fn()}
            onToggleListPost={vi.fn()}
            onRenderedRowsChange={onRenderedRowsChange}
          />
        </DensityContext.Provider>
      </ShowMediaContext.Provider>
    </ShowNsfwContext.Provider>,
  );
  return { ...view, scrollContainer, containerRef, onRenderedRowsChange };
};

// jsdom reports 0 for unstyled row heights, which would collapse the list's
// total height and hide the spacers. Give virtual rows a real measured height
// so the spacer / not-mounting-every-row behavior is observable.
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this instanceof HTMLElement && this.classList?.contains("virtual-row")) {
      return { width: 640, height: 200, top: 0, left: 0, right: 640, bottom: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

describe("VirtualPostList", () => {
  it("exposes loaded and rendered row counts on the list root", () => {
    const items = makeItems(5);
    const { container } = renderList(items);
    const list = container.querySelector(".virtual-list") as HTMLElement;
    expect(list).toBeTruthy();
    expect(list.getAttribute("data-total-rows")).toBe("5");
    const rendered = Number(list.getAttribute("data-rendered-rows"));
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(5);
  });

  it("reports the rendered row count to the development inspector", () => {
    const { onRenderedRowsChange } = renderList(makeItems(5));
    expect(onRenderedRowsChange.mock.calls.length).toBeGreaterThan(0);
    expect(onRenderedRowsChange.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it("mounts only a window of rows and renders a bottom spacer instead of the whole feed", async () => {
    const items = makeItems(30);
    const { container } = renderList(items);
    const list = container.querySelector(".virtual-list") as HTMLElement;
    const rendered = Number(list.getAttribute("data-rendered-rows"));
    expect(rendered).toBeLessThan(30);
    const rows = container.querySelectorAll(".virtual-row");
    expect(rows.length).toBe(rendered);
    await waitFor(() => {
      const spacers = container.querySelectorAll(".virtual-spacer");
      expect(spacers.length).toBeGreaterThan(0);
      expect((spacers[spacers.length - 1] as HTMLElement).style.height).not.toBe("0px");
    });
  });
});

describe("MeasuredPostRow", () => {
  it("wraps rows in a per-row error boundary so one bad record degrades a single row", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("boom");
    };
    const { container } = render(
      <MeasuredPostRow post={makePost("at://did:plc:author/app.bsky.feed.post/boom")} rowKey="k" onMeasured={vi.fn()}>
        <Boom />
      </MeasuredPostRow>,
    );
    const row = container.querySelector(".virtual-row") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute("data-post-uri")).toBe("at://did:plc:author/app.bsky.feed.post/boom");
    const fallback = container.querySelector(".post-row-error") as HTMLElement;
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).toContain("This post couldn");
    consoleError.mockRestore();
  });
});
