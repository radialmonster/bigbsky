import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOBILE_SCROLL_QUERY,
  __resetScrollRestoreStateForTests,
  armScrollRestore,
  readScrollOffset,
  resetScrollToTop,
  restoreOrResetScroll,
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

  it("keeps save-suppression armed while the restore loop is still running past the 2s window", () => {
    // rAF throttles to ~1 Hz on a backgrounded tab, so the 30-frame budget can
    // outlive armScrollRestore's fixed 2s deadline. If suppression lapsed
    // mid-restore, a save-on-scroll handler could persist the transient ~0
    // offset the loop is still correcting.
    const nowSpy = vi.spyOn(performance, "now");
    try {
      let clock = 1000;
      nowSpy.mockImplementation(() => clock);
      // A null container never reaches the target, so the loop keeps re-asserting.
      restoreScrollOffset({ current: null }, 500);
      expect(shouldSuppressScrollSave(0)).toBe(true);
      // Five backgrounded frames = 5s, well past the original 2s deadline.
      for (let i = 0; i < 5; i += 1) {
        clock += 1000;
        (rafQueue.shift() as FrameRequestCallback)(clock);
      }
      expect(rafQueue.length).toBeGreaterThan(0);
      expect(shouldSuppressScrollSave(0)).toBe(true);
      // Draining the remaining frames ends the loop, which releases the guard.
      flushFrames();
      expect(shouldSuppressScrollSave(0)).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
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

describe("restoreOrResetScroll / resetScrollToTop", () => {
  let rafQueue: FrameRequestCallback[];
  let rafSpy: { mockRestore: () => void };
  let windowScrollSpy: { mockRestore: () => void };
  const pinnedScrollers: Element[] = [];

  function pinScrollerToZero(el: Element) {
    Object.defineProperty(el, "scrollTop", { get: () => 0, set: () => {}, configurable: true });
    pinnedScrollers.push(el);
  }

  beforeEach(() => {
    __resetScrollRestoreStateForTests();
    rafQueue = [];
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
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

  it("resets a reused (previously-scrolled) container to the top when target is 0", () => {
    // The bug: navigating to a fresh feed reuses the .timeline node still holding
    // the previous feed's scrollTop. A zero target must actively reset it, not no-op.
    const reused = makeFakeTimeline(1200);
    restoreOrResetScroll({ current: reused }, 0);
    expect(reused.scrollTop).toBe(0);
    // Instant reset — no rAF restore loop is scheduled for a zero target.
    expect(rafQueue).toHaveLength(0);
  });

  it("restores a positive saved offset instead of resetting", () => {
    const timeline = makeFakeTimeline(0);
    restoreOrResetScroll({ current: timeline }, 500);
    // A positive target drives the restore loop (rAF scheduled), not an instant reset.
    expect(rafQueue.length).toBeGreaterThan(0);
    let runs = 0;
    while (rafQueue.length && runs < 40) {
      (rafQueue.shift() as FrameRequestCallback)(0);
      runs += 1;
    }
    expect(timeline.scrollTop).toBe(500);
  });

  it("supersedes an in-flight restore so the previous surface can't re-drive the shared container", () => {
    // Start restoring the previous feed to 400…
    const shared = makeFakeTimeline(0);
    restoreScrollOffset({ current: shared }, 400);
    // …then navigate to a fresh feed (target 0) that reuses the same container.
    resetScrollToTop({ current: shared });
    expect(shared.scrollTop).toBe(0);
    // Drain any frames the superseded restore loop had queued: it must observe the
    // bumped token and stop, leaving the container at the top rather than 400.
    let runs = 0;
    while (rafQueue.length && runs < 40) {
      (rafQueue.shift() as FrameRequestCallback)(0);
      runs += 1;
    }
    expect(shared.scrollTop).toBe(0);
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
