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
    // Keep the save-suppression window alive for as long as this loop is still
    // re-asserting the target. rAF throttles to ~1 Hz on a backgrounded tab, so
    // the frame budget can easily outlive armScrollRestore's fixed 2 s deadline;
    // once it lapsed, a save-on-scroll handler could persist the transient
    // near-zero offset we are in the middle of correcting. The loop's exit path
    // below clears the guard, so this can't keep suppression on indefinitely.
    armScrollRestore(top);
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

// Reset the (possibly reused) scroll container to the top. The `.timeline`
// element has no per-route key, so React reuses the same DOM node when
// navigating feed→feed / profile→profile / surface→surface; without an explicit
// reset the new surface inherits the previous one's scrollTop. That's doubly bad
// with virtualization: VirtualPostList compensates row-measurement growth with
// `scrollTop += height - previousHeight` (a guard that can only fire above 0), so
// an inherited non-zero offset then runs *away* from the top as rows measure.
// Bumping the shared restore token supersedes any in-flight restore loop from the
// previous surface so it can't keep re-driving the shared container after we've
// navigated away; a single reset to 0 then holds (the compensation guard can
// never hold at scrollTop 0 — see scrollFeedToTop).
export function resetScrollToTop(timelineRef: { readonly current: HTMLElement | null }) {
  scrollRestoreToken += 1;
  scrollRestoreGuard = null;
  scrollFeedToTop(timelineRef.current);
}

// Restore a saved offset, or actively reset to the top when there is none. Use
// this (not restoreScrollOffset directly) at navigation restore sites: a saved
// offset of 0 must still reset the reused container instead of silently no-oping
// and leaving the previous surface's scroll position in place.
export function restoreOrResetScroll(timelineRef: { readonly current: HTMLElement | null }, target: number) {
  if (target > 0) {
    restoreScrollOffset(timelineRef, target);
  } else {
    resetScrollToTop(timelineRef);
  }
}

// Content-anchor for scroll restoration. Restoration by raw pixel offset fights
// the virtualization measurement compensation (issue #8): re-asserting a stale
// pixel re-mounts rows near it at the too-tall default estimate, they measure
// shorter, totalHeight shrinks, and the browser clamps scrollTop back — so the
// restore never converges. Anchoring to the top-visible post URI (+ intra-row
// offset) instead lets the restored position derive from the *measured* row
// layout, which converges once rows settle.
export type ScrollAnchor = { uri: string; intra: number };

// Find the post row currently at the top edge of the scroll container. This is
// geometry-only (no scroll arithmetic), so it works whether the desktop
// `.timeline` element is the scroller or the document/body scrolls on mobile:
// the "top-visible" row is the first mounted `[data-post-uri]` row whose bottom
// edge crosses the container's on-screen top edge, and `intra` is how far the
// container's top edge has scrolled into that row (0 = the row starts exactly at
// the edge). The intra offset is viewport-local, so it is identical in both
// breakpoints; the restored scroll target derives from it against the live
// measured row layout.
export function readTopVisibleAnchor(container: HTMLElement | null): ScrollAnchor | null {
  if (!container) {
    return null;
  }
  const containerTop = container.getBoundingClientRect().top;
  for (const row of container.querySelectorAll<HTMLElement>("[data-post-uri]")) {
    const rect = row.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= containerTop) {
      // Hidden (display:none) or fully above the container's top edge.
      continue;
    }
    const uri = row.getAttribute("data-post-uri");
    if (uri) {
      return { uri, intra: Math.max(0, containerTop - rect.top) };
    }
  }
  return null;
}

// Clamp a desired content position to the live scrollable range of a virtualized
// list. Restoration must never target past the bottom of the measured content:
// the browser would clamp it anyway, and the measurement compensation would then
// fight the re-assertion (the root cause of #8).
export function clampScrollTarget(desired: number, totalHeight: number, viewportHeight: number): number {
  return Math.max(0, Math.min(desired, Math.max(0, totalHeight - viewportHeight)));
}

// Release the save-suppression guard held by a running restore. The anchored
// restore loop (in VirtualPostList) keeps suppression armed while it drives the
// container so transient near-zero offsets during the drive don't clobber the
// saved anchor; once the loop settles (or gives up), it calls this to let real
// user scrolls be saved again.
export function releaseScrollRestoreGuard() {
  scrollRestoreGuard = null;
}

// Test-only: reset the module-level restore state so each test starts clean.
export function __resetScrollRestoreStateForTests() {
  scrollRestoreGuard = null;
  scrollRestoreToken = 0;
}
