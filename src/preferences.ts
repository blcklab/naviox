import type { NavioxPreferencesOptions } from './types.js';

const DEFAULT_KEY = '@blcklab/naviox:preferences:v1';
const limited = (ids: unknown, limit: number): string[] => {
  if (!Array.isArray(ids)) return [];
  const found = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) found.add(id);
    if (found.size >= limit) break;
  }
  return [...found];
};

/** The preference store is per-instance, immutable on read, and never accesses a browser global. */
export function createPreferences(options: NavioxPreferencesOptions = {}, onChange: () => void) {
  const maxRecent = Number.isFinite(options.maxRecent) ? Math.max(0, Math.floor(options.maxRecent!)) : 20;
  const key = options.key ?? DEFAULT_KEY;
  let recent: string[] = [];
  let favorite: string[] = [];
  let pinned: string[] = [];
  let disposed = false;
  try {
    const raw = options.storage?.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === 1) {
        const data = parsed as { recent?: unknown; favorite?: unknown; pinned?: unknown };
        recent = limited(data.recent, maxRecent);
        favorite = limited(data.favorite, 10000);
        pinned = limited(data.pinned, 10000);
      }
    }
  } catch { /* Storage failures/corrupt payloads never prevent commands from working. */ }
  let snapshot = freeze();
  function freeze() {
    return Object.freeze({
      recentIds: Object.freeze([...recent]),
      favoriteIds: Object.freeze([...favorite]),
      pinnedIds: Object.freeze([...pinned]),
    });
  }
  function emit(): void {
    if (disposed) return;
    snapshot = freeze();
    try {
      options.storage?.setItem(key, JSON.stringify({ version: 1, recent, favorite, pinned }));
    } catch { /* storage may be unavailable, quota-limited or disabled */ }
    onChange();
  }
  function set(list: 'favorite' | 'pinned', id: string, value: boolean): void {
    if (disposed || !id.trim()) return;
    const target = list === 'favorite' ? favorite : pinned;
    if (target.includes(id) === value) return;
    if (list === 'favorite') favorite = value ? [...target, id] : target.filter((key) => key !== id);
    else pinned = value ? [...target, id] : target.filter((key) => key !== id);
    emit();
  }
  return {
    snapshot: () => snapshot,
    record(id: string) {
      if (disposed || !id.trim() || maxRecent === 0) return;
      recent = [id, ...recent.filter((key) => key !== id)].slice(0, maxRecent);
      emit();
    },
    setFavorite: (id: string, value: boolean) => set('favorite', id, value),
    setPinned: (id: string, value: boolean) => set('pinned', id, value),
    clearRecents() { if (!disposed && recent.length) { recent = []; emit(); } },
    destroy() { disposed = true; },
  };
}
