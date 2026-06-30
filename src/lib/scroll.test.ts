import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOBILE_SCROLL_QUERY,
  __resetScrollRestoreStateForTests,
  armScrollRestore,
  readScrollOffset,
  restoreScrollOffset,
  scrollFeedToTop,
  shouldSuppressScrollSave,
} from "./scroll";

// A fake scroll container whose `scrollTo({ top })` updates its own `scrollTop`,
// so readScrollOffset can observe the effect of a write (jsdom's real scrollTop
// is a no-op stub that always reads 0).
function makeFakeTimeline(initial = 0) {
  const el = {
    scrollTop: initial,
    scrollTo(opts: { top: number }) {
      el.scrollTop = opts.top;
    },
  };
  return el as unknown as HTMLElement;
}

describe("readScrollOffset", () => {
  it("returns the timeline scrollTop when it is the live scroller", () => {
    expect(readScrollOffset(makeFakeTimeline(640))).toBe(640);
  });

  it("returns 0 when nothing has scrolled", () => {
    expect(readScrollOffset(makeFakeTimeline(0))).toBe(0);
    expect(readScrollOffset(null)).toBe(0);
  });

  it("picks the maximum across candidate scrollers (window vs timeline)", () => {
    const scrollYSpy = vi.spyOn(window, "scrollY", "get").mockReturnValue(900);
    try {
      // Even though the timeline reports a smaller offset, the document/window
      // scroller is the live one, so its larger value wins.
      expect(readScrollOffset(makeFakeTimeline(120))).toBe(900);
    } finally {
      scrollYSpy.mockRestore();
    }
  });
});

describe("scroll-save suppression guard", () => {
  beforeEach(() => {
    __resetScrollRestoreStateForTests();
  });

  it("does not suppress when no restore is armed", () => {
    expect(shouldSuppressScrollSave(0)).toBe(false);
  });

  it("ignores a non-positive arm target", () => {
    armScrollRestore(0);
    expect(shouldSuppressScrollSave(0)).toBe(false);
    armScrollRestore(-50);
    expect(shouldSuppressScrollSave(0)).toBe(false);
  });

  it("suppresses transient ~0 offsets below the target, then releases at target", () => {
    armScrollRestore(500);
    expect(shouldSuppressScrollSave(0)).toBe(true);
    expect(shouldSuppressScrollSave(498)).toBe(true);
    // Within 1px of target counts as "arrived" — stop suppressing real scrolls.
    expect(shouldSuppressScrollSave(499)).toBe(false);
    expect(shouldSuppressScrollSave(500)).toBe(false);
  });

  it("expires the guard after its time window", () => {
    const nowSpy = vi.spyOn(performance, "now");
    try {
      nowSpy.mockReturnValue(1000);
      armScrollRestore(500);
      expect(shouldSuppressScrollSave(0)).toBe(true);
      // 2s window from armScrollRestore — jump just past it.
      nowSpy.mockReturnValue(1000 + 2000 + 1);
      expect(shouldSuppressScrollSave(0)).toBe(false);
      // Guard is cleared, so subsequent checks stay false.
      expect(shouldSuppressScrollSave(0)).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("restoreScrollOffset", () => {
  let rafQueue: FrameRequestCallback[];
  let rafSpy: { mockRestore: () => void };
  let windowScrollSpy: { mockRestore: () => void };

  function flushFrames(max = 60) {
    let runs = 0;
    while (rafQueue.length && runs < max) {
      const cb = rafQueue.shift()!;
      cb(runs);
      runs += 1;
    }
    return runs;
  }

  // jsdom *persists* scrollTop writes on the document scrollers, so once
  // scrollOffsetTo touches them they'd leak into readScrollOffset on later
  // frames and mask the fake timeline. Pin them to a constant 0 (with a no-op
  // setter so the scrollTop-fallback assignment doesn't throw on a getter-only
  // property) — that leaves the fake timeline as the only mutable scroller.
  const pinnedScrollers: Element[] = [];
  function pinScrollerToZero(el: Element) {
    Object.defineProperty(el, "scrollTop", { get: () => 0, set: () => {}, configurable: true });
    pinnedScrollers.push(el);
  }

  beforeEach(() => {
    __resetScrollRestoreStateForTests();
    rafQueue = [];
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
      });
    // jsdom's window.scrollTo is a "not implemented" stub; scrollOffsetTo calls
    // it, so neutralize it.
    windowScrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    pinScrollerToZero(document.documentElement);
    if (document.body) {
      pinScrollerToZero(document.body);
    }
  });

  afterEach(() => {
    rafSpy.mockRestore();
    windowScrollSpy.mockRestore();
    for (const el of pinnedScrollers.splice(0)) {
      delete (el as unknown as { scrollTop?: number }).scrollTop;
    }
  });

  it("does nothing for a non-positive target", () => {
    restoreScrollOffset({ current: makeFakeTimeline(0) }, 0);
    expect(rafQueue).toHaveLength(0);
  });

  it("drives the timeline to the saved offset and settles", () => {
    const timeline = makeFakeTimeline(0);
    restoreScrollOffset({ current: timeline }, 500);
    flushFrames();
    expect(timeline.scrollTop).toBe(500);
    // Once settled, the guard is released so real scrolls save again.
    expect(shouldSuppressScrollSave(0)).toBe(false);
  });

  it("re-resolves the live element each frame from the ref", () => {
    const ref: { current: HTMLElement | null } = { current: null };
    restoreScrollOffset(ref, 300);
    // First frame runs against a not-yet-mounted element (current === null)…
    const first = rafQueue.shift();
    first?.(0);
    expect(rafQueue.length).toBeGreaterThan(0);
    // …then the element mounts and later frames target it.
    const timeline = makeFakeTimeline(0);
    ref.current = timeline;
    flushFrames();
    expect(timeline.scrollTop).toBe(300);
  });

  it("supersedes an in-flight restore when a newer one starts", () => {
    const first = makeFakeTimeline(0);
    restoreScrollOffset({ current: first }, 400);
    // Start a second restore before the first loop drains.
    const second = makeFakeTimeline(0);
    restoreScrollOffset({ current: second }, 250);
    flushFrames();
    // The newer restore wins; the superseded loop stops touching its target.
    expect(second.scrollTop).toBe(250);
  });
});

describe("scrollFeedToTop", () => {
  it("jumps the timeline to 0 instantly", () => {
    const windowSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      const timeline = makeFakeTimeline(800);
      scrollFeedToTop(timeline);
      expect(timeline.scrollTop).toBe(0);
    } finally {
      windowSpy.mockRestore();
    }
  });
});

describe("MOBILE_SCROLL_QUERY", () => {
  it("matches the 720px mobile breakpoint", () => {
    expect(MOBILE_SCROLL_QUERY).toBe("(max-width: 720px)");
  });
});
