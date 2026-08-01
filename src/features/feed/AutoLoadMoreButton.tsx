import { useEffect, useRef } from "react";

// The auto-load sentinel sits inside a virtualized scroller whose overflow is
// clipped, so a viewport-root IntersectionObserver cannot preload early through
// the clipped scroller — auto-load would only fire once the sentinel reaches the
// actual bottom. Observing against the nearest scrollable ancestor lets the
// 640px margin preload the next page before the user hits the end, keeping
// endless scroll seamless. Falls back to the viewport when nothing scrolls.
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function AutoLoadMoreButton({ label, onLoadMore, error }: { label: string; onLoadMore: () => void; error?: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cooldownRef = useRef(false);

  useEffect(() => {
    const button = buttonRef.current;
    // When the previous page failed, stop auto-loading: requiring an explicit
    // retry click avoids hammering a rate-limited or unreachable endpoint.
    if (!button || error || !("IntersectionObserver" in window)) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || cooldownRef.current) {
          return;
        }

        cooldownRef.current = true;
        onLoadMore();
        window.setTimeout(() => {
          cooldownRef.current = false;
        }, 900);
      },
      { root: findScrollParent(button), rootMargin: "640px 0px 640px 0px" },
    );

    observer.observe(button);
    return () => observer.disconnect();
  }, [onLoadMore, error]);

  if (error) {
    return (
      <div className="load-more-error" role="status">
        <span>{error}</span>
        <button className="load-more" ref={buttonRef} type="button" onClick={onLoadMore}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <button className="load-more" ref={buttonRef} type="button" onClick={onLoadMore}>
      {label}
    </button>
  );
}

export function PostRowFallback() {
  return (
    <div className="post-row-error" role="alert">
      <p>This post couldn&apos;t be rendered.</p>
    </div>
  );
}
