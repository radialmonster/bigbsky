import { type ReactNode, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FeedItem, FeedPost, Profile } from "../../api";
import { ErrorBoundary } from "../../ErrorBoundary";
import { postHasVisualMedia } from "../../lib/loaders";
import { isAdultPost } from "../../lib/moderation";
import {
  armScrollRestore,
  clampScrollTarget,
  readScrollOffset,
  releaseScrollRestoreGuard,
  scrollOffsetTo,
  type ScrollAnchor,
} from "../../lib/scroll";
import { buildThreadedFeedRows, feedRowKey, feedRowPost, isThreadedFeedItem } from "../../lib/threads";
import { computeRowOffsets, estimateRowHeight, findRowIndexByOffset, isAboveViewport, overscanPixelsFor, totalRowHeight } from "../../lib/virtual-list";
import { PostComposer } from "../composer/PostComposer";
import { ShowNsfwContext } from "../common/useMediaReveal";
import type { LocalList } from "../lists/ListsSurface";
import { PostCard } from "../post/PostCard";
import type { ImageViewerState } from "../post/ImageViewer";
import { ThreadedPostCard, replyRootRefForPost, useComposerTargets } from "../thread/ThreadView";
import { PostRowFallback } from "./AutoLoadMoreButton";
import type { DensityMode } from "./FeedDensityControls";

// Frame budgets for the content-anchored restore loop in VirtualPostList. Like
// the pixel restore (restoreScrollOffset), the loop re-asserts the target across
// a few frames; the difference is the target is recomputed each frame from the
// live measured row layout and clamped against the live totalHeight, so it
// converges instead of fighting the measurement shrink (issue #8).
const SCROLL_ANCHOR_MAX_FRAMES = 60;
const SCROLL_ANCHOR_STABLE_FRAMES = 3;

export function VirtualPostList({
  children,
  containerRef,
  currentDid,
  density,
  items: incomingItems,
  localLists,
  mediaOnly = false,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  onRenderedRowsChange,
  scrollAnchor,
  scrollFallbackTarget = 0,
  onAnchorRestored,
}: {
  children?: ReactNode;
  containerRef: RefObject<HTMLDivElement | null>;
  currentDid?: string;
  density: DensityMode;
  items: FeedItem[];
  localLists: LocalList[];
  mediaOnly?: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onRenderedRowsChange: (count: number) => void;
  scrollAnchor?: ScrollAnchor | null;
  scrollFallbackTarget?: number;
  onAnchorRestored?: () => void;
}) {
  // When the NSFW preference is hidden, drop adult/graphic-labeled posts from
  // the feed entirely (not just gate their media), so they never appear.
  const showNsfw = useContext(ShowNsfwContext);
  const items = useMemo(
    () =>
      incomingItems.filter((item) => {
        if (!showNsfw && isAdultPost(item.post)) {
          return false;
        }
        return !mediaOnly || postHasVisualMedia(item.post);
      }),
    [incomingItems, mediaOnly, showNsfw],
  );
  const rows = useMemo(() => buildThreadedFeedRows(items), [items]);
  const defaultRowHeight = estimateRowHeight(density);
  const overscanPixels = overscanPixelsFor(defaultRowHeight);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  // Mirror the committed heights so onMeasured can read the previous height and
  // apply the scroll compensation *outside* the state updater (updaters must be
  // pure — running the scrollTop side effect inside one double-applies it under
  // StrictMode / concurrent retries). The ref is forward-synced synchronously so
  // back-to-back measurements in one batch still diff against the latest height.
  const rowHeightsRef = useRef(rowHeights);
  rowHeightsRef.current = rowHeights;
  const { activeReplyParentUri, activeQuoteUri, toggleReplyFor, toggleQuoteFor, closeReply, closeQuote } = useComposerTargets();
  const canReply = !!currentDid;
  const rowOffsets = useMemo(
    () => computeRowOffsets(rows, (row) => rowHeights[feedRowKey(row)], defaultRowHeight),
    [defaultRowHeight, rowHeights, rows],
  );
  const totalHeight = useMemo(
    () => totalRowHeight(rows, (row) => rowHeights[feedRowKey(row)], defaultRowHeight),
    [defaultRowHeight, rowHeights, rows],
  );
  const findRowIndex = useCallback((targetOffset: number) => findRowIndexByOffset(rowOffsets, targetOffset), [rowOffsets]);
  const startIndex = rows.length > 0 ? findRowIndex(Math.max(0, scrollTop - overscanPixels)) : 0;
  const endIndex =
    rows.length > 0 ? Math.min(rows.length - 1, findRowIndex(scrollTop + viewportHeight + overscanPixels) + 1) : -1;
  const visibleItems = endIndex >= startIndex ? rows.slice(startIndex, endIndex + 1) : [];
  const topSpacerHeight = rowOffsets[startIndex] ?? 0;
  const renderedHeight = visibleItems.reduce((total, row) => total + (rowHeights[feedRowKey(row)] ?? defaultRowHeight), 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - renderedHeight);

  useEffect(() => {
    setRowHeights((current) => {
      const next = Object.fromEntries(rows.map((row) => [feedRowKey(row), current[feedRowKey(row)]]).filter(([, height]) => !!height));
      return Object.keys(next).length === Object.keys(current).length ? current : (next as Record<string, number>);
    });
  }, [rows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const updateViewport = () => {
      setScrollTop(container.scrollTop);
      setViewportHeight(container.clientHeight || 720);
    };

    updateViewport();
    container.addEventListener("scroll", updateViewport, { passive: true });
    const observer = "ResizeObserver" in window ? new ResizeObserver(updateViewport) : null;
    observer?.observe(container);

    return () => {
      container.removeEventListener("scroll", updateViewport);
      observer?.disconnect();
    };
  }, [containerRef]);

  useEffect(() => {
    onRenderedRowsChange(visibleItems.length);
  }, [onRenderedRowsChange, visibleItems.length]);

  // Content-anchored scroll restore (issue #8). The raw-pixel restore re-asserts
  // a fixed offset that fights the virtualization measurement shrink: each
  // re-assertion re-mounts rows near the target at the too-tall default estimate,
  // they measure shorter, totalHeight shrinks, and scrollTop clamps back — so it
  // never converges. Instead, anchor to the saved top-visible post URI: once that
  // row is present and measured, target = its live row offset + intra-row offset,
  // clamped against the live totalHeight. The target is recomputed from the live
  // measured layout every frame (via refs, so the loop always sees the latest
  // measurements), so the restore converges to the real content position rather
  // than fighting it. Once the offset holds at the (recomputed) target for a few
  // frames, or the frame budget runs out, clear the pending anchor.
  const anchoredRowsRef = useRef(rows);
  anchoredRowsRef.current = rows;
  const anchoredRowOffsetsRef = useRef(rowOffsets);
  anchoredRowOffsetsRef.current = rowOffsets;
  const anchoredTotalHeightRef = useRef(totalHeight);
  anchoredTotalHeightRef.current = totalHeight;
  const anchoredViewportHeightRef = useRef(viewportHeight);
  anchoredViewportHeightRef.current = viewportHeight;
  const anchoredRestoreTokenRef = useRef(0);

  useEffect(() => {
    if (!scrollAnchor) {
      return undefined;
    }
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const token = ++anchoredRestoreTokenRef.current;
    let frames = 0;
    let stable = 0;
    let cancelled = false;
    const apply = () => {
      if (cancelled || token !== anchoredRestoreTokenRef.current) {
        return;
      }
      const liveRows = anchoredRowsRef.current;
      const liveOffsets = anchoredRowOffsetsRef.current;
      const liveTotal = anchoredTotalHeightRef.current;
      const liveViewport = anchoredViewportHeightRef.current;
      const anchorIndex = liveRows.findIndex((row) => feedRowPost(row).uri === scrollAnchor.uri);
      frames += 1;
      if (anchorIndex < 0) {
        // Anchor post not in the loaded rows yet (async surface load). Wait for
        // rows to include it — the effect restarts with a fresh budget whenever
        // rows change (rows is a dep), so a slow load resumes automatically. If
        // rows exist but the anchor is genuinely gone (content changed), fall
        // back to the saved pixel offset so the restore still happens.
        if (liveRows.length > 0 && frames > 4) {
          const fallback = clampScrollTarget(scrollFallbackTarget, liveTotal, liveViewport);
          if (Math.abs(readScrollOffset(container) - fallback) > 1) {
            scrollOffsetTo(container, fallback);
            stable = 0;
          } else {
            stable += 1;
          }
          if (stable >= SCROLL_ANCHOR_STABLE_FRAMES || frames >= SCROLL_ANCHOR_MAX_FRAMES) {
            releaseScrollRestoreGuard();
            onAnchorRestored?.();
            return;
          }
        }
        // Rows still empty: keep waiting within a generous cap, but do NOT clear
        // the anchor on cap exhaustion — the rows-change restart (or unmount)
        // owns that. The cap only bounds the rAF loop itself.
        if (frames < 300) {
          requestAnimationFrame(apply);
        }
        return;
      }
      const target = clampScrollTarget((liveOffsets[anchorIndex] ?? 0) + scrollAnchor.intra, liveTotal, liveViewport);
      armScrollRestore(target);
      if (Math.abs(readScrollOffset(container) - target) > 1) {
        scrollOffsetTo(container, target);
        stable = 0;
      } else {
        stable += 1;
      }
      if (frames >= SCROLL_ANCHOR_MAX_FRAMES || stable >= SCROLL_ANCHOR_STABLE_FRAMES) {
        releaseScrollRestoreGuard();
        onAnchorRestored?.();
        return;
      }
      requestAnimationFrame(apply);
    };
    requestAnimationFrame(apply);
    return () => {
      cancelled = true;
    };
  }, [scrollAnchor, scrollFallbackTarget, onAnchorRestored, rows]);

  // Stable across scroll frames (only rows/offsets/height changes recreate it),
  // so MeasuredPostRow's effect (deps: [rowKey, onMeasured]) does not tear
  // down and re-create a ResizeObserver for every visible row on every scroll.
  const handleRowMeasured = useCallback(
    (rowKey: string, height: number) => {
      const previousHeight = rowHeightsRef.current[rowKey] ?? defaultRowHeight;
      if (previousHeight === height) {
        return;
      }

      // Keep the offset stable when a row above the viewport changes size:
      // grow/shrink the scroll position by the same delta so the content
      // under the user's eyes doesn't jump. Done here (not in the updater)
      // to keep setRowHeights pure.
      const rowIndex = anchoredRowsRef.current.findIndex((candidate) => feedRowKey(candidate) === rowKey);
      const rowTop = rowIndex >= 0 ? anchoredRowOffsetsRef.current[rowIndex] ?? 0 : 0;
      const container = containerRef.current;
      if (container && isAboveViewport(rowTop, previousHeight, container.scrollTop)) {
        container.scrollTop += height - previousHeight;
      }

      // Forward-sync the ref so a sibling measurement in the same batch
      // diffs against this height before the state commit lands.
      rowHeightsRef.current = { ...rowHeightsRef.current, [rowKey]: height };
      setRowHeights((current) =>
        (current[rowKey] ?? defaultRowHeight) === height ? current : { ...current, [rowKey]: height },
      );
    },
    [containerRef, defaultRowHeight],
  );

  return (
    <div
      className="virtual-list"
      data-total-rows={items.length}
      data-rendered-rows={visibleItems.length}
    >
      {topSpacerHeight > 0 && <div className="virtual-spacer" style={{ height: topSpacerHeight }} />}
      {visibleItems.map((row) => (
        <MeasuredPostRow
          post={feedRowPost(row)}
          rowKey={feedRowKey(row)}
          key={feedRowKey(row)}
          onMeasured={handleRowMeasured}
        >
          {(() => {
            const rowPost = feedRowPost(row);
            return (
              <>
                {isThreadedFeedItem(row) ? (
                  <ThreadedPostCard
                    thread={row}
                    onOpenImage={onOpenImage}
                    onOpenPost={onOpenPost}
                    onOpenProfile={onOpenProfile}
                    onReply={canReply ? (post) => toggleReplyFor(post.uri) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                    onQuote={canReply ? (post) => toggleQuoteFor(post.uri) : undefined}
                    quoteActive={activeQuoteUri === rowPost.uri}
                  />
                ) : (
                  <PostCard
                    item={row}
                    currentDid={currentDid}
                    onOpenImage={onOpenImage}
                    onOpenPost={onOpenPost}
                    onOpenProfile={onOpenProfile}
                    onReply={canReply ? (post) => toggleReplyFor(post.uri) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                    onQuote={canReply ? (post) => toggleQuoteFor(post.uri) : undefined}
                    quoteActive={activeQuoteUri === rowPost.uri}
                    localLists={localLists}
                    onToggleListPost={onToggleListPost}
                  />
                )}
                {activeReplyParentUri === rowPost.uri && (
                  <PostComposer
                    replyTo={{ parent: rowPost, root: replyRootRefForPost(rowPost) }}
                    canReply={canReply}
                    onClose={closeReply}
                  />
                )}
                {activeQuoteUri === rowPost.uri && (
                  <PostComposer
                    quote={rowPost}
                    onClose={closeQuote}
                  />
                )}
              </>
            );
          })()}
        </MeasuredPostRow>
      ))}
      {bottomSpacerHeight > 0 && <div className="virtual-spacer" style={{ height: bottomSpacerHeight }} />}
      {children}
    </div>
  );
}

export function MeasuredPostRow({
  children,
  post,
  rowKey,
  onMeasured,
}: {
  children: ReactNode;
  post: FeedPost;
  rowKey: string;
  onMeasured: (rowKey: string, height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return undefined;
    }

    const measure = () => onMeasured(rowKey, Math.ceil(row.getBoundingClientRect().height));
    measure();
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    observer?.observe(row);

    return () => observer?.disconnect();
  }, [rowKey, onMeasured]);

  return (
    <div className="virtual-row" data-post-uri={post.uri} ref={rowRef}>
      {/* Per-row boundary (H1): one malformed record degrades a single row to a
          compact fallback instead of unmounting the whole feed. The boundary
          adds no wrapper DOM in the happy path, so row measurement is unchanged. */}
      <ErrorBoundary label={`post-row:${post.uri}`} fallback={() => <PostRowFallback />}>
        {children}
      </ErrorBoundary>
    </div>
  );
}
