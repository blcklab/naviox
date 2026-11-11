import { createNavioxRegistry } from './registry.js';
import { sectionItems } from './groups.js';
import { rankItems } from './search.js';
import { matchesNavioxShortcut } from './shortcuts.js';
import { createProviderManager } from './providers.js';
import { createPreferences } from './preferences.js';
import { createNavioxExtensionHost } from './extensions.js';
import type {
  NavioxActionContext, NavioxActivationResult, NavioxChangeReason, NavioxControlledState,
  NavioxController, NavioxExecutionResult, NavioxExecutionState, NavioxGroup, NavioxItem,
  NavioxKeyResult, NavioxListener, NavioxOptions, NavioxShortcutEvent,
  NavioxShortcutResult, NavioxState,
} from './types.js';

const canFocus = (item: NavioxItem): boolean => !item.disabled;
const canSelect = (item: NavioxItem): boolean => !item.disabled && !item.readOnly;
const firstEnabled = (items: readonly NavioxItem[]): string | null => items.find(canFocus)?.id ?? null;
const sameControls = (a: NavioxControlledState, b: NavioxControlledState): boolean =>
  a.open === b.open && a.query === b.query && a.activeId === b.activeId;
const controlsOf = (s: NavioxControlledState): NavioxControlledState => ({
  open: s.open, query: s.query, activeId: s.activeId,
});
const idleExecution: NavioxExecutionState = Object.freeze({ status: 'idle', itemId: null });

/** DOM-free navigation, search and action engine. Root page is identified by null. */
export function createNaviox(items: readonly NavioxItem[] = [], options: NavioxOptions = {}): NavioxController {
  const registry = createNavioxRegistry(items);
  const listeners = new Set<NavioxListener>();
  const notifications: NavioxState[] = [];
  const max = options.maxResults ?? 50;
  const limit = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : 50;
  const pageSize = Number.isFinite(options.pageSize) && (options.pageSize ?? 0) > 0
    ? Math.trunc(options.pageSize!) : 8;
  const loop = options.loop ?? true;
  const platform = options.shortcuts?.platform ?? 'other';
  const toggles = options.shortcuts?.toggle === undefined ? ['Mod+K']
    : typeof options.shortcuts.toggle === 'string' ? [options.shortcuts.toggle] : options.shortcuts.toggle;
  let disposed = false;
  let broadcasting = false;
  let running: AbortController | null = null;
  let executionGeneration = 0;
  const extensions = createNavioxExtensionHost(() => controller, options.onExtensionError);
  let groups: readonly NavioxGroup[] = Object.freeze([]);
  const collapsed = new Set<string>();
  const preferences = createPreferences(options.preferences, () => { if (!disposed) apply({}, state.open && !options.controlled, true); });
  const providers = createProviderManager(options.providers, () => { if (!disposed) apply({}, state.open && !options.controlled, true); });

  function validateGroups(input: readonly NavioxGroup[]): readonly NavioxGroup[] {
    const seen = new Set<string>();
    return Object.freeze(input.map((entry) => {
      if (!entry.id?.trim() || seen.has(entry.id)) throw new Error(`Invalid or duplicate Naviox group id: ${entry.id}`);
      seen.add(entry.id);
      return Object.freeze({ ...entry });
    }));
  }
  groups = validateGroups(options.groups ?? []);
  for (const group of groups) if (group.defaultCollapsed) collapsed.add(group.id);

  let state: NavioxState;
  const current = options.controlled?.state;
  const initial: Omit<NavioxState, 'results' | 'sections' | 'breadcrumbs'> = {
    open: current?.open ?? options.defaultOpen ?? false,
    query: current?.query ?? options.defaultQuery ?? '',
    activeId: current ? current.activeId : (options.defaultActiveId ?? null),
    pageId: null,
    pageStack: Object.freeze([]),
    context: Object.freeze({}),
    lastSelectedId: null,
    collapsedGroupIds: Object.freeze([...collapsed]),
    execution: idleExecution,
    providers: providers.snapshot(), providersLoading: providers.isLoading(), totalResults: 0,
    ...preferences.snapshot(),
  };

  function makeState(values: Omit<NavioxState, 'results' | 'sections' | 'breadcrumbs'>, fallback: boolean): NavioxState {
    const excludedGroups = new Set(groups.filter((group) => group.disabled).map((group) => group.id));
    // Local items always win ID collisions. Providers are priority-ordered, not registry mutations.
    const catalog = registry.getItems();
    const seen = new Set(catalog.map((item) => item.id));
    const sourcePriority = new Map(catalog.map((item) => [item.id, 0]));
    const combined = [...catalog];
    for (const { item, sourcePriority: priority } of providers.items({ query: values.query, pageId: values.pageId, context: values.context })) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
      sourcePriority.set(item.id, priority);
    }
    const prefs = preferences.snapshot();
    const favorite = new Set(prefs.favoriteIds);
    const pinned = new Set(prefs.pinnedIds);
    const recentOrder = new Map(prefs.recentIds.map((id, index) => [id, index]));
    const usePreferenceSort = options.preferences?.prioritizeOnEmptyQuery === true && !values.query.trim();
    const ranked = rankItems(combined, values.query, Number.MAX_SAFE_INTEGER, {
      ...options.search,
      context: values.context,
      filter: (item, ctx) => (item.parentId ?? item.pageId ?? null) === values.pageId
        && (!item.group || !excludedGroups.has(item.group))
        && (options.search?.filter?.(item, ctx) ?? true),
      compare: (a, b) => {
        if (options.search?.compare) {
          const result = options.search.compare(a, b);
          return Number.isFinite(result) && result !== 0 ? result : a.index - b.index;
        }
        if (values.query.trim() && a.score !== b.score) return b.score - a.score;
        if (usePreferenceSort) {
          const weight = (id: string): number => (pinned.has(id) ? 1_000_000 : 0)
            + (favorite.has(id) ? 10_000 : 0)
            + (recentOrder.has(id) ? Math.max(1, 1_000 - recentOrder.get(id)!) : 0);
          const gap = weight(b.item.id) - weight(a.item.id);
          if (gap) return gap;
        }
        const priority = (sourcePriority.get(b.item.id) ?? 0) - (sourcePriority.get(a.item.id) ?? 0);
        if (priority) return priority;
        const itemPriority = (b.item.priority ?? 0) - (a.item.priority ?? 0);
        return itemPriority || a.index - b.index;
      },
    }).map((entry) => entry.item);
    const projection = sectionItems(ranked, groups, collapsed, options.groupResults ?? false);
    const results = Object.freeze(projection.visible.slice(0, limit));
    const included = new Set(results.map((item) => item.id));
    const sections = Object.freeze(projection.sections.map((section) => Object.freeze({
      ...section,
      items: Object.freeze(section.items.filter((item) => included.has(item.id))),
    })).filter((section) => section.collapsed || section.items.length > 0));
    const valid = values.activeId !== null && results.some((item) => item.id === values.activeId && canFocus(item));
    const activeId = valid ? values.activeId : (fallback ? firstEnabled(results) : null);
    const breadcrumbs = Object.freeze(values.pageStack.map((id) => Object.freeze({
      id, title: registry.get(id)?.title ?? id,
    })));
    return Object.freeze({
      ...values,
      pageStack: Object.freeze([...values.pageStack]),
      breadcrumbs,
      collapsedGroupIds: Object.freeze([...collapsed]),
      providers: providers.snapshot(), providersLoading: providers.isLoading(),
      totalResults: projection.visible.length,
      ...prefs,
      activeId,
      results,
      sections,
    });
  }
  state = makeState(initial, initial.open && !options.controlled);

  function notify(next: NavioxState, force = false): void {
    if (disposed) return;
    if (!force && next.open === state.open && next.query === state.query && next.activeId === state.activeId
      && next.pageId === state.pageId && next.context === state.context
      && next.lastSelectedId === state.lastSelectedId && next.execution === state.execution
      && next.providers === state.providers && next.providersLoading === state.providersLoading
      && next.totalResults === state.totalResults
      && next.recentIds === state.recentIds && next.favoriteIds === state.favoriteIds
      && next.pinnedIds === state.pinnedIds
      && next.pageStack.length === state.pageStack.length
      && next.pageStack.every((id, i) => id === state.pageStack[i])
      && next.collapsedGroupIds.length === state.collapsedGroupIds.length
      && next.collapsedGroupIds.every((id, i) => id === state.collapsedGroupIds[i])
      && next.results.length === state.results.length
      && next.results.every((item, i) => item === state.results[i])) return;
    state = next;
    notifications.push(next);
    if (broadcasting) return;
    broadcasting = true;
    try {
      while (notifications.length) {
        const published = notifications.shift()!;
        for (const listener of [...listeners]) if (!disposed && listeners.has(listener)) listener(published);
      }
    } finally {
      broadcasting = false;
    }
    providers.observe({ query: state.query, pageId: state.pageId, context: state.context }, state.open);
  }

  function apply(values: Partial<Omit<NavioxState, 'results' | 'sections' | 'breadcrumbs'>>, fallback: boolean, force = false): void {
    if (!disposed) notify(makeState({ ...state, ...values }, fallback), force);
  }

  function request(controls: NavioxControlledState, reason: NavioxChangeReason): void {
    if (disposed || sameControls(state, controls)) return;
    if (options.controlled) options.controlled.onChange(Object.freeze(controlsOf(controls)), reason);
    else apply(controls, controls.open && controls.activeId !== null);
  }

  function transitionPage(stack: readonly string[], reason: 'page' | 'back' = 'page'): void {
    const pageStack = Object.freeze([...stack]);
    const pageId = pageStack.at(-1) ?? null;
    if (options.controlled) {
      apply({ pageStack, pageId }, false);
      const proposed = makeState({ ...state, query: '', activeId: null }, state.open);
      request(controlsOf(proposed), reason);
    } else {
      notify(makeState({ ...state, pageStack, pageId, query: '', activeId: null }, state.open));
    }
  }

  function hasChildren(id: string): boolean {
    return registry.getItems().some((item) => (item.parentId ?? item.pageId ?? null) === id && !item.hidden);
  }

  function accessible(item: NavioxItem): boolean {
    return canSelect(item) && !item.hidden
      && !groups.some((group) => group.disabled && group.id === item.group)
      && (options.search?.filter?.(item, state.context) ?? true);
  }

  function closePalette(cancel: boolean): void {
    if (disposed || !state.open) return;
    if (cancel) controller.cancelExecution();
    if (state.pageStack.length && !options.controlled) apply({ pageId: null, pageStack: Object.freeze([]) }, false);
    request({ open: false, query: '', activeId: null }, 'close');
  }

  const removeRegistryListener = registry.subscribe(() => { if (!disposed) apply({}, state.open && !options.controlled, true); });
  const ignored = (item: NavioxItem | null): NavioxExecutionResult => ({ status: 'ignored', item });

  const controller: NavioxController = {
    use: (extension) => extensions.use(extension),
    listExtensions: () => extensions.list(),
    getState: () => state,
    getItems: () => registry.getItems(),
    getGroups: () => groups,
    getProviders: () => providers.getProviders(),
    registerProvider: (provider) => providers.register(provider),
    unregisterProvider: (id) => providers.unregister(id),
    refreshProviders: () => providers.refresh({ query: state.query, pageId: state.pageId, context: state.context }),
    loadMore: (id) => providers.loadMore(id),
    clearProviderCache: () => providers.clearCache(),
    setFavorite: (id, value) => preferences.setFavorite(id, value),
    toggleFavorite: (id) => preferences.setFavorite(id, !preferences.snapshot().favoriteIds.includes(id)),
    setPinned: (id, value) => preferences.setPinned(id, value),
    togglePinned: (id) => preferences.setPinned(id, !preferences.snapshot().pinnedIds.includes(id)),
    clearRecents: () => preferences.clearRecents(),
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setItems: (next) => { if (!disposed) registry.replace(next); },
    register: (item) => registry.register(item),
    registerMany: (entries) => registry.registerMany(entries),
    updateItem: (id, patch) => registry.update(id, patch),
    unregister: (id) => registry.unregister(id),
    setGroups(next) {
      if (disposed) return;
      const updated = validateGroups(next);
      const previous = new Set(groups.map((group) => group.id));
      for (const entry of updated) if (!previous.has(entry.id) && entry.defaultCollapsed) collapsed.add(entry.id);
      groups = updated;
      apply({}, state.open, true);
    },
    setGroupCollapsed(groupId, isCollapsed) {
      if (disposed || !groupId.trim() || collapsed.has(groupId) === isCollapsed) return;
      if (isCollapsed) collapsed.add(groupId); else collapsed.delete(groupId);
      apply({}, state.open, true);
    },
    toggleGroup(groupId) {
      if (!disposed) controller.setGroupCollapsed(groupId, !collapsed.has(groupId));
    },
    setQuery(query) {
      if (disposed || state.query === query) return;
      const proposed = makeState({ ...state, query, activeId: null }, true);
      request(controlsOf(proposed), 'query');
    },
    setPage(pageId) {
      if (disposed || state.pageId === pageId) return;
      transitionPage(pageId === null ? [] : [pageId]);
    },
    pushPage(pageId) {
      if (disposed || !pageId || state.pageStack.includes(pageId) || !hasChildren(pageId)) return false;
      transitionPage([...state.pageStack, pageId]);
      return true;
    },
    back() {
      if (disposed || !state.pageStack.length) return false;
      transitionPage(state.pageStack.slice(0, -1), 'back');
      return true;
    },
    setContext(context) { if (!disposed) apply({ context: Object.freeze({ ...context }) }, state.open); },
    syncControlledState(next) {
      if (disposed) return;
      if (!options.controlled) throw new Error('syncControlledState requires options.controlled');
      apply(controlsOf(next), next.open && next.activeId !== null);
    },
    open() {
      if (disposed || state.open) return;
      const proposed = makeState({ ...state, open: true }, true);
      request(controlsOf(proposed), 'open');
    },
    close() { closePalette(true); },
    toggle() { if (state.open) controller.close(); else controller.open(); },
    move(delta) {
      if (disposed || !state.open || !Number.isFinite(delta)) return;
      const step = Math.trunc(delta);
      if (!step) return;
      const available = state.results.filter(canFocus);
      if (!available.length) return;
      const index = available.findIndex((item) => item.id === state.activeId);
      const destination = index === -1 ? (step > 0 ? 0 : available.length - 1) :
        (loop ? ((index + step) % available.length + available.length) % available.length
          : Math.max(0, Math.min(available.length - 1, index + step)));
      request({ ...controlsOf(state), activeId: available[destination]?.id ?? null }, 'move');
    },
    jump(delta) {
      if (disposed || !state.open || !Number.isFinite(delta)) return;
      const step = Math.trunc(delta);
      if (!step) return;
      const available = state.results.filter(canFocus);
      if (!available.length) return;
      const index = available.findIndex((item) => item.id === state.activeId);
      const destination = index === -1 ? (step > 0 ? 0 : available.length - 1)
        : Math.max(0, Math.min(available.length - 1, index + step));
      request({ ...controlsOf(state), activeId: available[destination]?.id ?? null }, 'move');
    },
    setActive(id) {
      if (disposed || !state.open || state.activeId === id) return;
      if (!state.results.some((item) => item.id === id && canFocus(item))) return;
      request({ ...controlsOf(state), activeId: id }, 'active');
    },
    /** M1 behavior remains data-only, deliberately never invokes perform. */
    select(id = state.activeId ?? '') {
      if (disposed || !state.open) return null;
      const item = state.results.find((entry) => entry.id === id && canSelect(entry)) ?? null;
      if (!item) return null;
      if (options.preferences) preferences.record(item.id);
      apply({ lastSelectedId: item.id }, state.open);
      if (state.pageStack.length && !options.controlled) apply({ pageId: null, pageStack: Object.freeze([]) }, false);
      request({ open: false, query: '', activeId: null }, 'select');
      return item;
    },
    activate(id = state.activeId ?? ''): NavioxActivationResult {
      if (disposed || !state.open) return { kind: 'none', item: null };
      const item = state.results.find((entry) => entry.id === id && canSelect(entry)) ?? null;
      if (!item) return { kind: 'none', item: null };
      if (hasChildren(item.id) && controller.pushPage(item.id)) return { kind: 'page', item };
      if (item.perform || (item.href && options.navigate)) {
        return { kind: 'executing', item, completion: controller.execute(item.id) };
      }
      return { kind: 'selected', item: controller.select(item.id) };
    },
    async execute(id): Promise<NavioxExecutionResult> {
      const item = registry.get(id) ?? providers.getItem(id, {
        query: state.query, pageId: state.pageId, context: state.context,
      });
      if (disposed || !item || !accessible(item)) return ignored(item);
      const handler = item.perform ?? (item.href && options.navigate ? (ctx: NavioxActionContext) => options.navigate!(item, ctx) : undefined);
      if (!handler) return ignored(item);
      controller.cancelExecution();
      const abort = new AbortController();
      running = abort;
      const ticket = ++executionGeneration;
      const query = state.query;
      const context = state.context;
      apply({ lastSelectedId: item.id, execution: Object.freeze({ status: 'running', itemId: item.id }) }, state.open);
      const actionContext: NavioxActionContext = Object.freeze({
        item, query, context, signal: abort.signal,
        reportProgress(progress: { readonly message?: string; readonly current?: number; readonly total?: number }) {
          if (disposed || running !== abort || abort.signal.aborted) return;
          apply({ execution: Object.freeze({ status: 'running', itemId: item.id, progress: Object.freeze({ ...progress }) }) }, state.open);
        },
        close: () => { if (!disposed) closePalette(false); },
        setPage: (pageId: string | null) => { if (!disposed) controller.setPage(pageId); },
      });
      const wasCancelled = (): boolean => disposed || running !== abort || abort.signal.aborted;
      try {
        if (extensions.hasBefore() && !(await extensions.runBefore(actionContext))) {
          if (wasCancelled()) return { status: 'cancelled', item };
          running = null;
          apply({ execution: Object.freeze({ status: 'cancelled', itemId: item.id }) }, state.open);
          const cancelled: NavioxExecutionResult = { status: 'cancelled', item };
          await extensions.runAfter(cancelled, actionContext);
          return cancelled;
        }
        if (wasCancelled()) return { status: 'cancelled', item };
        const value = await handler(actionContext);
        if (wasCancelled()) return { status: 'cancelled', item };
        running = null;
        if (options.preferences) preferences.record(item.id);
        apply({ execution: Object.freeze({ status: 'success', itemId: item.id }) }, state.open);
        const success: NavioxExecutionResult = { status: 'success', item, value };
        await extensions.runAfter(success, actionContext);
        // An asynchronous post-hook must not close a newer command's UI.
        if (!disposed && executionGeneration === ticket && item.closeOnExecute !== false) controller.close();
        return success;
      } catch (error: unknown) {
        if (wasCancelled()) return { status: 'cancelled', item };
        running = null;
        apply({ execution: Object.freeze({ status: 'error', itemId: item.id, error }) }, state.open);
        const failed: NavioxExecutionResult = { status: 'error', item, error };
        await extensions.runAfter(failed, actionContext);
        return failed;
      }
    },
    cancelExecution() {
      if (disposed || !running) return;
      running.abort();
      running = null;
      apply({ execution: Object.freeze({ status: 'cancelled', itemId: state.execution.itemId }) }, state.open);
    },
    handleShortcut(event: NavioxShortcutEvent): NavioxShortcutResult {
      if (disposed || event.repeat || event.isComposing) return { handled: false, item: null };
      if (toggles.some((entry) => matchesNavioxShortcut(entry, event, platform))) {
        controller.toggle();
        return { handled: true, item: null };
      }
      const enabled = [...registry.getItems(), ...providers.items({ query: state.query, pageId: state.pageId, context: state.context }).map(({ item }) => item)]
        .filter((item) => accessible(item)
        && (item.shortcutScope !== 'page' || (item.parentId ?? item.pageId ?? null) === state.pageId)
        && item.shortcuts?.some((shortcut) => matchesNavioxShortcut(shortcut, event, platform)));
      enabled.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      const item = enabled[0] ?? null;
      if (!item) return { handled: false, item: null };
      if (hasChildren(item.id)) {
        if (!state.open) controller.open();
        if (controller.pushPage(item.id)) return { handled: true, item };
      }
      if (item.perform || (item.href && options.navigate)) {
        return { handled: true, item, execution: controller.execute(item.id) };
      }
      // The host may use the selected item for its own routing or UI behavior.
      return { handled: true, item };
    },
    handleKey(key): NavioxKeyResult {
      if (disposed || !state.open) return { handled: false, selected: null };
      switch (key) {
        case 'ArrowDown': controller.move(1); break;
        case 'ArrowUp': controller.move(-1); break;
        case 'PageDown': controller.jump(pageSize); break;
        case 'PageUp': controller.jump(-pageSize); break;
        case 'Home': {
          const first = state.results.find(canFocus);
          if (first) controller.setActive(first.id);
          break;
        }
        case 'End': {
          const last = state.results.filter(canFocus).at(-1);
          if (last) controller.setActive(last.id);
          break;
        }
        case 'Backspace':
          return { handled: !state.query && controller.back(), selected: null };
        case 'Alt+ArrowLeft':
          return { handled: controller.back(), selected: null };
        case 'Escape':
          if (!controller.back()) controller.close();
          break;
        case 'Enter': {
          const activated = controller.activate();
          return { handled: true, selected: activated.kind === 'page' ? null : activated.item, execution: activated.completion };
        }
        default: return { handled: false, selected: null };
      }
      return { handled: true, selected: null };
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      running?.abort();
      running = null;
      extensions.destroy();
      removeRegistryListener();
      providers.destroy();
      preferences.destroy();
      registry.destroy();
      listeners.clear();
      notifications.length = 0;
    },
  };
  providers.observe({ query: state.query, pageId: state.pageId, context: state.context }, state.open);
  try {
    for (const extension of options.extensions ?? []) controller.use(extension);
  } catch (error) {
    controller.destroy();
    throw error;
  }
  return controller;
}
