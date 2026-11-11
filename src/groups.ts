import type { NavioxGroup, NavioxItem, NavioxSection } from './types.js';

/** Group projection. Ungrouped items use an empty ID. Registry metadata is optional. */
export function sectionItems(
  items: readonly NavioxItem[],
  groups: readonly NavioxGroup[],
  collapsedIds: ReadonlySet<string>,
  reorder = false,
): { sections: readonly NavioxSection[]; visible: readonly NavioxItem[] } {
  const info = new Map(groups.map((group) => [group.id, group]));
  const buckets = new Map<string, NavioxItem[]>();
  for (const item of items) {
    const id = item.group ?? '';
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id)!.push(item);
  }
  const ordered = [...buckets.entries()].map(([id, members], index) => ({ id, members, index }));
  if (reorder) ordered.sort((a, b) => (info.get(a.id)?.order ?? 0) - (info.get(b.id)?.order ?? 0) || a.index - b.index);
  const sections = Object.freeze(ordered.map(({ id, members }) => Object.freeze({
    id,
    title: info.get(id)?.title ?? id,
    items: Object.freeze(collapsedIds.has(id) ? [] : [...members]),
    total: members.length,
    collapsed: collapsedIds.has(id),
  } satisfies NavioxSection)));
  // Default keeps M1's ranked global order, even if groups interleave.
  const visible = reorder ? sections.flatMap((section) => section.items) : items.filter((item) => !collapsedIds.has(item.group ?? ''));
  return { sections, visible: Object.freeze(visible) };
}
