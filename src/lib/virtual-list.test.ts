import { describe, expect, it } from "vitest";

import {
  computeRowOffsets,
  estimateRowHeight,
  findRowIndexByOffset,
  isAboveViewport,
  overscanPixelsFor,
  totalRowHeight,
} from "./virtual-list";

describe("estimateRowHeight", () => {
  it("estimates per density mode", () => {
    expect(estimateRowHeight("compact")).toBe(112);
    expect(estimateRowHeight("media")).toBe(360);
    expect(estimateRowHeight("comfortable")).toBe(260);
  });
});

describe("overscanPixelsFor", () => {
  it("scales a bounded overscan window off the estimated row height", () => {
    expect(overscanPixelsFor(112)).toBe(336);
    expect(overscanPixelsFor(260)).toBe(780);
    expect(overscanPixelsFor(360)).toBe(1080);
  });
});

describe("findRowIndexByOffset", () => {
  it("returns 0 for an empty list", () => {
    expect(findRowIndexByOffset([], 500)).toBe(0);
  });

  it("returns the last row whose offset is at or before the target", () => {
    const offsets = [0, 120, 250, 400];
    expect(findRowIndexByOffset(offsets, 0)).toBe(0);
    expect(findRowIndexByOffset(offsets, 119)).toBe(0);
    expect(findRowIndexByOffset(offsets, 120)).toBe(1);
    expect(findRowIndexByOffset(offsets, 249)).toBe(1);
    expect(findRowIndexByOffset(offsets, 400)).toBe(3);
  });

  it("returns the last row when the target is past the end", () => {
    expect(findRowIndexByOffset([0, 120, 250], 10000)).toBe(2);
  });

  it("returns 0 when the target precedes the first row", () => {
    expect(findRowIndexByOffset([100, 200], 50)).toBe(0);
  });
});

describe("computeRowOffsets", () => {
  const rows = ["a", "b", "c"] as const;
  const heights = { a: 100, b: 200, c: 300 } as const;

  it("accumulates top offsets from measured heights", () => {
    expect(computeRowOffsets(rows, (row) => heights[row as keyof typeof heights], 260)).toEqual([0, 100, 300]);
  });

  it("defaults unmeasured rows to the estimate", () => {
    expect(computeRowOffsets(rows, () => undefined, 260)).toEqual([0, 260, 520]);
  });

  it("grows each offset by the previous row's height", () => {
    expect(computeRowOffsets(["a", "b"], (row) => (row === "a" ? 50 : undefined), 100)).toEqual([0, 50]);
  });
});

describe("totalRowHeight", () => {
  const rows = ["a", "b"] as const;

  it("sums measured heights", () => {
    expect(totalRowHeight(rows, (row) => (row === "a" ? 100 : 200), 260)).toBe(300);
  });

  it("defaults unmeasured rows to the estimate", () => {
    expect(totalRowHeight(rows, () => undefined, 260)).toBe(520);
  });

  it("is 0 for an empty list", () => {
    expect(totalRowHeight([], () => undefined, 260)).toBe(0);
  });
});

describe("isAboveViewport", () => {
  it("is true when the row ends at or above the current scrollTop", () => {
    expect(isAboveViewport(0, 100, 100)).toBe(true);
    expect(isAboveViewport(50, 100, 150)).toBe(true);
    expect(isAboveViewport(0, 100, 500)).toBe(true);
  });

  it("is false when the row still overlaps the viewport", () => {
    expect(isAboveViewport(0, 100, 99)).toBe(false);
    expect(isAboveViewport(50, 100, 100)).toBe(false);
  });
});
