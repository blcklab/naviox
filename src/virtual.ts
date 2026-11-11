import type { NavioxVirtualOptions, NavioxVirtualWindow } from './types.js';

/** Pure fixed-estimate virtual window. The UI owns measurement and scroll events. */
export function getNavioxVirtualWindow<T>(
  items: readonly T[], options: NavioxVirtualOptions,
): NavioxVirtualWindow<T> {
  const { scrollOffset, viewportSize, estimatedItemSize } = options;
  if (!Number.isFinite(estimatedItemSize) || estimatedItemSize <= 0) {
    throw new RangeError('estimatedItemSize must be a finite, positive number');
  }
  if (!Number.isFinite(scrollOffset) || !Number.isFinite(viewportSize)) {
    throw new RangeError('scrollOffset and viewportSize must be finite');
  }
  const count = items.length;
  const size = estimatedItemSize;
  const overscan = Number.isFinite(options.overscan) ? Math.max(0, Math.floor(options.overscan!)) : 3;
  const boundedScroll = Math.min(Math.max(0, scrollOffset), Math.max(0, count * size - Math.max(0, viewportSize)));
  const start = Math.min(count, Math.max(0, Math.floor(boundedScroll / size) - overscan));
  const visibleEnd = Math.ceil((boundedScroll + Math.max(0, viewportSize)) / size);
  const end = Math.max(start, Math.min(count, visibleEnd + overscan));
  return Object.freeze({
    start, end, total: count, totalSize: count * size,
    paddingStart: start * size, paddingEnd: (count - end) * size,
    items: Object.freeze(items.slice(start, end)),
  });
}
