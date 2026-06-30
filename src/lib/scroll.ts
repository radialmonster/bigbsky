// Scroll geometry + scroll-restoration helpers, extracted from App.tsx so the
// breakpoint-dependent scroller logic and the multi-frame restore loop can be
// unit-tested in isolation.
//
// The scroll container differs by breakpoint: on desktop the bounded
// `.timeline` element scrolls, but on mobile `<html>` stays overflow:hidden
// while `body`/`#root` become height:auto + overflow-y:auto, so the document
// body is the real scroller and `timeline.scrollTop` (and often `window.scrollY`)
// stays 0. These helpers read/write whichever container is actually active so
// scroll restoration, back-to-top, and the header-hide logic all agree about the
// live offset.

export const MOBILE_SCROLL_QUERY = "(max-width: 720px)";

// Live scroll offset of whichever element is actually scrolling. Only one
// candidate is non-zero at a time, so the max always picks the live offset
// regardless of which element scrolls.
export function readScrollOffset(timeline: HTMLElement | null): number {
  if (typeof window === "undefined") {
    return 0;
  }
  return Math.max(
    window.scrollY,
    document.scrollingElement?.scrollTop ?? 0,
    document.documentElement?.scrollTop ?? 0,
    document.body?.scrollTop ?? 0,
    timeline?.scrollTop ?? 0,
  );
}

function scrollElementTo(element: Element | null | undefined, top: number, behavior?: ScrollBehavior) {
  if (!element) {
    return;
  }
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top, behavior });
  } else {
    element.scrollTop = top;
  }
}

// Scroll every plausible feed scroller. The button visibility uses
// `readScrollOffset`, which can be driven by the document, body, or `.timeline`
// depending on breakpoint/browser. Writing all of them keeps the action paired
// with whichever one made the button appear.
export function scrollOffsetTo(timeline: HTMLElement | null, top: number, behavior?: ScrollBehavior) {
  window.scrollTo({ top, behavior });
  scrollElementTo(document.scrollingElement, top, behavior);
  scrollElementTo(document.documentElement, top, behavior);
  scrollElementTo(document.body, top, behavior);
  scrollElementTo(timeline, top, behavior);
}

// Jump instantly to the top of the feed. We deliberately do NOT use a smooth
// scroll here: VirtualPostList keeps the viewport stable when a row above it
// resizes by doing `container.scrollTop += height - previousHeight` (see the
// onMeasured compensation in VirtualPostList). As a smooth scroll-to-top runs,
// previously virtualized top rows mount, measure taller than the default
// estimate, and that compensation fires — and any direct `scrollTop` assignment
// cancels the in-flight smooth animation (CSSOM View spec), so the scroll halts
// partway. An instant jump to 0 sidesteps this: the compensation's guard
// (`rowTop + previousHeight <= scrollTop`) can never hold at scrollTop === 0,
// so the jump lands at the top and stays there.
export function scrollFeedToTop(timeline: HTMLElement | null) {
  scrollOffsetTo(timeline, 0);
}

// While a saved offset is being restored, the document briefly sits near the
// top before the scroll lands. Suppress save-on-scroll during that window so a
// transient ~0 offset doesn't clobber the value we're trying to restore.
let scrollRestoreGuard: { target: number; until: number } | null = null;

// Monotonic token so a newer restore invalidates any prior rAF apply loop.
// Without it, rapid navigation between cached feeds runs two loops against the
// one shared scrollRestoreGuard, jittering toward different targets for ~30
// frames.
let scrollRestoreToken = 0;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

// Arm (or refresh) the suppression window for an offset we intend to restore.
export function armScrollRestore(target: number) {
  if (target <= 0) {
    return;
  }
  scrollRestoreGuard = { target, until: nowMs() + 2000 };
}

export function shouldSuppressScrollSave(currentOffset: number): boolean {
  if (!scrollRestoreGuard) {
    return false;
  }
  if (nowMs() > scrollRestoreGuard.until) {
    scrollRestoreGuard = null;
    return false;
  }
  // Once the document has reached (or passed) the target the restore is done;
  // let real user scrolls — including an intentional scroll back to the top —
  // be saved again.
  return currentOffset < scrollRestoreGuard.target - 1;
}

// How long to keep re-asserting the restore target, and how many consecutive
// frames the offset must hold at target before we consider the restore settled.
const SCROLL_RESTORE_MAX_FRAMES = 30;
const SCROLL_RESTORE_STABLE_FRAMES = 3;

// Restore a saved scroll offset after a navigation/cache hit. A single
// post-render scroll often lands short because the feed content (virtualized
// rows, images, embeds) is still growing, so the early offset clamps to a
// shorter document and any stray scroll event would then overwrite the saved
// value with ~0. Re-apply across a few frames until the target is reachable.
// Takes the ref (not its current value) because the destination route's
// `.timeline` element usually has not mounted yet at the synchronous call site
// — it appears a frame or two later. Re-resolving inside each frame targets the
// live element instead of a stale/detached one.
export function restoreScrollOffset(timelineRef: { readonly current: HTMLElement | null }, top: number) {
  if (top <= 0) {
    return;
  }
  const token = ++scrollRestoreToken;
  armScrollRestore(top);
  let frames = 0;
  // Count of consecutive frames the offset has already reached the target. We do
  // NOT stop the first frame the target is momentarily reached: the feed content
  // (virtualized rows measuring, images/embeds loading) keeps growing for a few
  // frames after a cache hit or fresh load, and the list can briefly remount and
  // reset scrollTop to 0. Re-asserting `top` whenever the offset falls short and
  // only finishing once it has *held* at target for a few consecutive frames lets
  // the restore survive that late reflow instead of bailing early and landing at 0.
  let stable = 0;
  const apply = () => {
    // A newer restore superseded this one — stop so the two loops don't fight
    // over the shared guard/scroll position.
    if (token !== scrollRestoreToken) {
      return;
    }
    const timeline = timelineRef.current;
    if (readScrollOffset(timeline) < top - 1) {
      scrollOffsetTo(timeline, top);
      stable = 0;
    } else {
      stable += 1;
    }
    frames += 1;
    if (frames < SCROLL_RESTORE_MAX_FRAMES && stable < SCROLL_RESTORE_STABLE_FRAMES) {
      requestAnimationFrame(apply);
    } else {
      scrollRestoreGuard = null;
    }
  };
  requestAnimationFrame(apply);
}

// Test-only: reset the module-level restore state so each test starts clean.
export function __resetScrollRestoreStateForTests() {
  scrollRestoreGuard = null;
  scrollRestoreToken = 0;
}
