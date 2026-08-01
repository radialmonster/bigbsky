import { useEffect, useState, type RefObject } from "react";
import { ChevronUp } from "lucide-react";
import { readScrollOffset, scrollFeedToTop } from "../../lib/scroll";

// "Back to top" affordance for the wide endless-scroll reader. Appears after the
// active timeline is scrolled past a threshold and returns to the top without a
// route change. watchKey re-attaches the scroll listener when the mounted
// timeline element changes (feed <-> profile, or active source).
export function BackToTopButton({ containerRef, watchKey }: { containerRef: RefObject<HTMLDivElement | null>; watchKey: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let el = containerRef.current;
    let rafId: number | null = null;
    // On mobile the document scrolls (el.scrollTop stays ~0), so read the
    // active offset and listen on window too; on desktop el is the scroller.
    const onScroll = () => setVisible(readScrollOffset(el) > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    const attachEl = (node: HTMLDivElement) => {
      el = node;
      node.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    };
    if (el) {
      attachEl(el);
    } else {
      // The scroll container may not be mounted yet (feed still loading). Poll a
      // bounded number of frames so the desktop container's scroll is observed
      // once it appears — otherwise the button only reacts to window scroll and
      // never shows on desktop (where the container, not the window, scrolls).
      let frames = 0;
      const wait = () => {
        const node = containerRef.current;
        if (node) {
          attachEl(node);
        } else if (frames++ < 120) {
          rafId = requestAnimationFrame(wait);
        }
      };
      rafId = requestAnimationFrame(wait);
    }
    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", onScroll);
      el?.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, watchKey]);
  if (!visible) {
    return null;
  }
  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => {
        scrollFeedToTop(containerRef.current);
        setVisible(false);
      }}
      aria-label="Scroll to top of feed"
      title="Back to top"
    >
      <ChevronUp size={18} />
      <span>Top</span>
    </button>
  );
}
