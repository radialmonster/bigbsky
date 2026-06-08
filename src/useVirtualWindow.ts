import { useMemo } from "react";

type VirtualWindowOptions = {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  estimateSize: number;
  overscan?: number;
};

export function useVirtualWindow({
  itemCount,
  scrollTop,
  viewportHeight,
  estimateSize,
  overscan = 5,
}: VirtualWindowOptions) {
  return useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan);
    const visibleCount = Math.ceil(viewportHeight / estimateSize) + overscan * 2;
    const end = Math.min(itemCount, start + visibleCount);

    return {
      start,
      end,
      beforeHeight: start * estimateSize,
      afterHeight: Math.max(0, (itemCount - end) * estimateSize),
      indexes: Array.from({ length: end - start }, (_, offset) => start + offset),
    };
  }, [estimateSize, itemCount, overscan, scrollTop, viewportHeight]);
}
