import { snapshotItem } from './registry.js';
import type {
  NavioxItem, NavioxProvider, NavioxProviderRequest, NavioxProviderResponse,
  NavioxProvidersOptions, NavioxProviderState,
} from './types.js';

interface RequestScope {
  readonly query: string;
  readonly pageId: string | null;
  readonly context: Readonly<Record<string, unknown>>;
}
interface ProviderEntry {
  provider: NavioxProvider;
  items: readonly NavioxItem[];
  state: NavioxProviderState;
  generation: number;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  active: Promise<void> | null;
  pendingResolve: (() => void) | null;
  scope: RequestScope | null;
}
const idle = (): NavioxProviderState => Object.freeze({ status: 'idle', total: 0, hasMore: false, nextCursor: null });

function validate(provider: NavioxProvider): void {
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim() || typeof provider.search !== 'function') {
    throw new TypeError('Provider requires a nonempty string id and a search function');
  }
  if (provider.debounceMs !== undefined && (!Number.isFinite(provider.debounceMs) || provider.debounceMs < 0)) {
    throw new RangeError('Provider debounceMs must be nonnegative');
  }
}

/** Internal provider coordinator. No browser state, network client, or external dependency. */
export function createProviderManager(options: NavioxProvidersOptions = {}, onChange: () => void) {
  const entries = new Map<string, ProviderEntry>();
  const cache = new Map<string, { response: NavioxProviderResponse; expires: number }>();
  const useCache = options.cache !== undefined && (options.cache.ttlMs ?? 60_000) > 0 && (options.cache.maxEntries ?? 100) > 0;
  const ttl = Math.max(0, options.cache?.ttlMs ?? 60_000);
  const maxCache = Math.max(0, Math.floor(options.cache?.maxEntries ?? 100));
  const pageSize = Number.isFinite(options.pageSize) && (options.pageSize ?? 0) > 0 ? Math.floor(options.pageSize!) : 25;
  const defaultDebounce = Number.isFinite(options.debounceMs) && (options.debounceMs ?? 0) >= 0 ? options.debounceMs! : 120;
  let disposed = false;
  let contextVersion = 0;
  let observed: { scope: RequestScope; open: boolean } | null = null;
  let statuses: Readonly<Record<string, NavioxProviderState>> = Object.freeze({});
  let loading = false;

  function publish(): void {
    if (disposed) return;
    statuses = Object.freeze(Object.fromEntries([...entries].map(([id, entry]) => [id, entry.state])));
    loading = [...entries.values()].some((entry) => entry.state.status === 'loading');
    onChange();
  }
  function stop(entry: ProviderEntry): void {
    entry.generation++;
    entry.pendingResolve?.();
    entry.pendingResolve = null;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.controller?.abort();
    entry.controller = null;
    entry.active = null;
  }
  function makeKey(providerId: string, scope: RequestScope, cursor: string | null): string {
    return JSON.stringify([providerId, scope.query, scope.pageId, contextVersion, cursor]);
  }
  function cacheRead(key: string): NavioxProviderResponse | undefined {
    if (!useCache) return undefined;
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() >= hit.expires) { cache.delete(key); return undefined; }
    cache.delete(key);
    cache.set(key, hit);
    return hit.response;
  }
  function cacheWrite(key: string, response: NavioxProviderResponse): void {
    if (!useCache) return;
    cache.delete(key);
    cache.set(key, { response, expires: Date.now() + ttl });
    while (cache.size > maxCache) cache.delete(cache.keys().next().value!);
  }
  function applyResponse(entry: ProviderEntry, response: NavioxProviderResponse, scope: RequestScope, cursor: string | null, fromCache: boolean): void {
    if (!response || !Array.isArray(response.items)) throw new TypeError('Provider response requires an items array');
    const seen = new Set(cursor === null ? [] : entry.items.map((item) => item.id));
    const updated = cursor === null ? [] : [...entry.items];
    for (const original of response.items) {
      const item = snapshotItem(scope.pageId !== null && original.parentId == null && original.pageId == null
        ? { ...original, pageId: scope.pageId } : original);
      if (!seen.has(item.id)) { seen.add(item.id); updated.push(item); }
    }
    const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor.length > 0 && response.nextCursor !== cursor
      ? response.nextCursor : null;
    entry.items = Object.freeze(updated);
    entry.state = Object.freeze({ status: 'success', total: updated.length, hasMore: nextCursor !== null, nextCursor, fromCache });
  }
  async function run(entry: ProviderEntry, scope: RequestScope, cursor: string | null, generation: number, bypassCache: boolean): Promise<void> {
    const key = makeKey(entry.provider.id, scope, cursor);
    const saved = bypassCache ? undefined : cacheRead(key);
    if (saved) {
      if (disposed || !entries.has(entry.provider.id) || entry.generation !== generation) return;
      try { applyResponse(entry, saved, scope, cursor, true); }
      catch (error) { entry.state = Object.freeze({ ...entry.state, status: 'error', error }); }
      entry.active = null;
      publish();
      return;
    }
    const controller = new AbortController();
    entry.controller = controller;
    entry.state = Object.freeze({ ...entry.state, status: 'loading', error: undefined, fromCache: false });
    publish();
    const request: NavioxProviderRequest = Object.freeze({
      query: scope.query, pageId: scope.pageId, context: scope.context,
      cursor, limit: pageSize, signal: controller.signal,
    });
    try {
      const response = await entry.provider.search(request);
      if (disposed || controller.signal.aborted || entries.get(entry.provider.id) !== entry || entry.generation !== generation) return;
      applyResponse(entry, response, scope, cursor, false);
      cacheWrite(key, Object.freeze({ items: Object.freeze(response.items.map(snapshotItem)), nextCursor: response.nextCursor ?? null }));
    } catch (error: unknown) {
      if (disposed || controller.signal.aborted || entries.get(entry.provider.id) !== entry || entry.generation !== generation) return;
      entry.state = Object.freeze({ ...entry.state, status: 'error', error, fromCache: false });
    } finally {
      if (entry.controller === controller) { entry.controller = null; entry.active = null; publish(); }
    }
  }
  function search(entry: ProviderEntry, scope: RequestScope, delay: number, bypassCache: boolean): Promise<void> {
    stop(entry);
    entry.items = Object.freeze([]);
    entry.scope = scope;
    entry.state = Object.freeze({ status: 'loading', total: 0, hasMore: false, nextCursor: null });
    const generation = entry.generation;
    // Auto requests may be debounced, explicit refresh bypasses the delay.
    if (delay > 0) {
      return new Promise<void>((resolve) => {
        entry.pendingResolve = resolve;
        entry.timer = setTimeout(() => {
          entry.timer = null;
          entry.pendingResolve = null;
          if (disposed || entry.generation !== generation) { resolve(); return; }
          const task = run(entry, scope, null, generation, bypassCache);
          entry.active = task;
          void task.finally(resolve);
        }, delay);
        // Note: cancelled timer promises are not awaited by auto observers.
      });
    }
    const task = run(entry, scope, null, generation, bypassCache);
    entry.active = task;
    return task;
  }
  function observe(scope: RequestScope, open: boolean): void {
    if (disposed) return;
    const prev = observed;
    if (prev && prev.scope.query === scope.query && prev.scope.pageId === scope.pageId
      && prev.scope.context === scope.context && prev.open === open) return;
    if (prev && prev.scope.context !== scope.context) { contextVersion++; cache.clear(); }
    observed = { scope, open };
    if (!entries.size) return;
    if (!open && !options.searchWhenClosed) {
      for (const entry of entries.values()) {
        stop(entry);
        if (entry.state.status === 'loading') entry.state = Object.freeze({ ...entry.state, status: 'idle' });
      }
      publish();
      return;
    }
    for (const entry of entries.values()) {
      void search(entry, scope, entry.provider.debounceMs ?? defaultDebounce, false);
    }
    publish();
  }
  for (const provider of options.initial ?? []) {
    validate(provider);
    if (entries.has(provider.id)) throw new Error(`Duplicate Naviox provider id: ${provider.id}`);
    entries.set(provider.id, {
      provider, items: Object.freeze([]), state: idle(), generation: 0,
      controller: null, timer: null, active: null, pendingResolve: null, scope: null,
    });
  }
  statuses = Object.freeze(Object.fromEntries([...entries].map(([id, entry]) => [id, entry.state])));
  return {
    snapshot: () => statuses,
    isLoading: () => loading,
    items(scope?: RequestScope): readonly { item: NavioxItem; sourcePriority: number }[] {
      return [...entries.values()].filter((entry) => !scope || (entry.scope?.query === scope.query
        && entry.scope?.pageId === scope.pageId && entry.scope?.context === scope.context))
        .sort((a, b) => (b.provider.priority ?? 0) - (a.provider.priority ?? 0))
        .flatMap((entry) => entry.items.map((item) => ({ item, sourcePriority: entry.provider.priority ?? 0 })));
    },
    getProviders: (): readonly NavioxProvider[] => Object.freeze([...entries.values()].map((entry) => entry.provider)),
    getItem(id: string, scope: RequestScope): NavioxItem | null {
      for (const { item } of this.items(scope)) if (item.id === id) return item;
      return null;
    },
    observe,
    register(provider: NavioxProvider): () => void {
      if (disposed) return () => {};
      validate(provider);
      if (entries.has(provider.id)) throw new Error(`Duplicate Naviox provider id: ${provider.id}`);
      const entry: ProviderEntry = { provider, items: Object.freeze([]), state: idle(), generation: 0,
        controller: null, timer: null, active: null, pendingResolve: null, scope: null };
      entries.set(provider.id, entry);
      publish();
      if (observed && (observed.open || options.searchWhenClosed)) {
        void search(entry, observed.scope, provider.debounceMs ?? defaultDebounce, false);
        publish();
      }
      return () => { if (entries.get(provider.id) === entry) this.unregister(provider.id); };
    },
    unregister(id: string): boolean {
      const entry = entries.get(id);
      if (disposed || !entry) return false;
      stop(entry);
      entries.delete(id);
      for (const key of [...cache.keys()]) if (key.startsWith(JSON.stringify([id]).slice(0, -1) + ',')) cache.delete(key);
      publish();
      return true;
    },
    async refresh(scope: RequestScope): Promise<void> {
      if (disposed) return;
      observed = { scope, open: observed?.open ?? false };
      await Promise.all([...entries.values()].map((entry) => search(entry, scope, 0, true)));
    },
    async loadMore(id: string): Promise<boolean> {
      const entry = entries.get(id);
      if (disposed || !entry || !observed || !entry.state.hasMore || !entry.state.nextCursor || entry.state.status === 'loading') return false;
      const cursor = entry.state.nextCursor;
      const generation = ++entry.generation;
      const task = run(entry, observed.scope, cursor, generation, false);
      entry.active = task;
      await task;
      return entry.state.status === 'success';
    },
    clearCache() { cache.clear(); },
    destroy() {
      disposed = true;
      for (const entry of entries.values()) stop(entry);
      entries.clear(); cache.clear();
    },
  };
}
