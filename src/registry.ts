import type { NavioxItem, NavioxRegistry } from './types.js';

/** Clone and freeze supported metadata so external callers cannot mutate an active catalog. */
export function snapshotItem(item: NavioxItem): NavioxItem {
  if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.title !== 'string') {
    throw new TypeError('Naviox items require a nonempty string id and a string title');
  }
  return Object.freeze({
    ...item,
    keywords: item.keywords === undefined ? undefined : Object.freeze([...item.keywords]),
    aliases: item.aliases === undefined ? undefined : Object.freeze([...item.aliases]),
    shortcuts: item.shortcuts === undefined ? undefined : Object.freeze([...item.shortcuts]),
    preview: item.preview === undefined ? undefined : Object.freeze({
      ...item.preview,
      meta: item.preview.meta === undefined ? undefined : Object.freeze(item.preview.meta.map((entry) => Object.freeze({ ...entry }))),
    }),
  });
}

function toCatalog(items: readonly NavioxItem[]): Map<string, NavioxItem> {
  const catalog = new Map<string, NavioxItem>();
  for (const original of items) {
    const item = snapshotItem(original);
    if (catalog.has(item.id)) throw new Error(`Duplicate Naviox item id: ${item.id}`);
    catalog.set(item.id, item);
  }
  return catalog;
}

/** Standalone observable registry; can be consumed without a controller. */
export function createNavioxRegistry(initialItems: readonly NavioxItem[] = []): NavioxRegistry {
  let catalog = toCatalog(initialItems);
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  const unregisterIfSame = (id: string, item: NavioxItem): void => {
    if (disposed || catalog.get(id) !== item) return;
    catalog.delete(id);
    notify();
  };

  const registry: NavioxRegistry = {
    getItems: () => Object.freeze([...catalog.values()]),
    get: (id) => catalog.get(id),
    register(item) {
      const dispose = registry.registerMany([item]);
      return dispose;
    },
    registerMany(items) {
      if (disposed) return () => {};
      if (!items.length) return () => {};
      const additions = toCatalog(items);
      for (const id of additions.keys()) {
        if (catalog.has(id)) throw new Error(`Duplicate Naviox item id: ${id}`);
      }
      for (const [id, item] of additions) catalog.set(id, item);
      notify();
      return () => { for (const [id, item] of additions) unregisterIfSame(id, item); };
    },
    update(id, patch) {
      if (disposed) return false;
      const old = catalog.get(id);
      if (!old) return false;
      // A JS consumer cannot change the identity via an unexpected patch.id.
      const { id: _ignored, ...allowed } = patch as Partial<NavioxItem>;
      const next = snapshotItem({ ...old, ...allowed, id });
      catalog.set(id, next); // Map.set retains order.
      notify();
      return true;
    },
    unregister(id) {
      if (disposed || !catalog.delete(id)) return false;
      notify();
      return true;
    },
    replace(items) {
      if (disposed) return;
      const next = toCatalog(items);
      catalog = next;
      notify();
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() { disposed = true; listeners.clear(); catalog.clear(); },
  };
  return registry;
}
