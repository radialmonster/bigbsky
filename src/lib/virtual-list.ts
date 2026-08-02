// Pure virtual-list measurement math extracted from App.tsx's VirtualPostList so
// it can be unit-tested in isolation (mirrors lib/threads.ts / lib/scroll.ts).
// The estimate/measure mismatch here is the driver of the scroll-compensation
// logic: rows mount at a too-tall default estimate, measure shorter, and the
// container offset must be adjusted so content under the user's eyes doesn't
// jump. Keeping the math pure and tested lets the layout behavior verifier pin
// behavior instead of App.tsx source (issue #19).

// Density-aware estimated height for an unmeasured row. These are deliberately
// distinct per density mode: media rows reserve a tall media frame, compact
// rows stay short, comfortable rows sit in between.
export function estimateRowHeight(density: "comfortable" | "compact" | "media"): number {
  return density === "compact" ? 112 : density === "media" ? 360 : 260;
}

// The overscan window around the viewport: 3x the estimated row height keeps
// fast scrolling from flashing blank rows without mounting the whole feed.
export function overscanPixelsFor(rowHeight: number): number {
  return rowHeight * 3;
}

// Binary-search the last row whose top offset is at or before targetOffset.
// Returns 0 when the target precedes every row (or the list is empty), so call
// sites can safely use the result as a start index.
export function findRowIndexByOffset(rowOffsets: readonly number[], targetOffset: number): number {
  let low = 0;
  let high = rowOffsets.length - 1;
  let match = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if ((rowOffsets[middle] ?? 0) <= targetOffset) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

// Cumulative top offsets for each row, growing by the row's measured height (or
// the estimate when it hasn't been measured yet). The offset of row N is the
// sum of heights of rows 0..N-1.
export function computeRowOffsets<T>(
  rows: readonly T[],
  heightOf: (row: T) => number | undefined,
  defaultRowHeight: number,
): number[] {
  let offset = 0;
  return rows.map((row) => {
    const top = offset;
    offset += heightOf(row) ?? defaultRowHeight;
    return top;
  });
}

// Total height of all rows (measured heights, defaulting to the estimate).
export function totalRowHeight<T>(rows: readonly T[], heightOf: (row: T) => number | undefined, defaultRowHeight: number): number {
  return rows.reduce((total, row) => total + (heightOf(row) ?? defaultRowHeight), 0);
}

// Whether a resized row sits fully above the viewport's current scrollTop, in
// which case the scroll position must shift by the size delta to keep content
// under the user's eyes stable.
export function isAboveViewport(rowTop: number, previousHeight: number, scrollTop: number): boolean {
  return rowTop + previousHeight <= scrollTop;
}
