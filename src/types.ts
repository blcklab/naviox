/** A command, route, page, document, or other item in Naviox. */
export interface NavioxItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Display group identifier. Groups do not have to be registered. */
  readonly group?: string;
  readonly kind?: string;
  readonly href?: string;
  readonly keywords?: readonly string[];
  readonly aliases?: readonly string[];
  /** Optional page scope. Omitted means the root page. */
  readonly pageId?: string | null;
  /** M2: parent item ID. Takes precedence over pageId for nested navigation. */
  readonly parentId?: string | null;
  /** Core never assumes browser navigation. Handler is injected via options.navigate. */
  readonly perform?: (context: NavioxActionContext) => unknown | Promise<unknown>;
  /** Portable shortcuts, e.g. Mod+K, Ctrl+Shift+P, G. */
  readonly shortcuts?: readonly string[];
  /** Global shortcuts work outside palette/page; page shortcuts require current page. */
  readonly shortcutScope?: 'global' | 'page';
  /** Default true: close only after a successful execution. */
  readonly closeOnExecute?: boolean;
  /** A small tie-breaking search boost; does not suppress relevance. */
  readonly priority?: number;
  readonly disabled?: boolean;
  /** Focusable for inspection but not executable/selectable. */
  readonly readOnly?: boolean;
  /** Excluded from search results and selection. */
  readonly hidden?: boolean;
  readonly preview?: {
    readonly image?: string;
    readonly imageAlt?: string;
    readonly description?: string;
    readonly meta?: readonly { readonly label: string; readonly value: string }[];
  };
}

/** A semantic command definition. Execution is intentionally delegated to callers in M1. */
export interface NavioxCommandItem extends NavioxItem {
  readonly kind: 'command';
}

/** A semantic route definition. Navigation is intentionally delegated to callers in M1. */
export interface NavioxRouteItem extends NavioxItem {
  readonly kind: 'route';
  readonly href: string;
}

/** Metadata for a visual group; grouping and rendering remain adapter responsibilities. */
export interface NavioxGroup {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly disabled?: boolean;
  /** Collapse this group by default. */
  readonly defaultCollapsed?: boolean;
}

export interface NavioxSearchWeights {
  readonly title: number;
  readonly description: number;
  readonly group: number;
  readonly kind: number;
  readonly keywords: number;
  readonly aliases: number;
}

export interface NavioxRankedItem {
  readonly item: NavioxItem;
  readonly score: number;
  readonly index: number;
}

export interface NavioxSearchOptions {
  readonly weights?: Partial<NavioxSearchWeights>;
  /** Return 0 or a negative number to exclude an item. Overrides builtin scoring. */
  readonly score?: (item: NavioxItem, query: string, tokens: readonly string[]) => number;
  /** Applied for empty and nonempty queries; context is managed by the controller. */
  readonly filter?: (item: NavioxItem, context: Readonly<Record<string, unknown>>) => boolean;
  /** Optional comparison for matched results. Stable source order resolves ties. */
  readonly compare?: (a: NavioxRankedItem, b: NavioxRankedItem) => number;
  /** Internal/advanced scope, ordinarily provided by a controller. */
  readonly context?: Readonly<Record<string, unknown>>;
}


/** A data source. Items must have globally unique IDs for action dispatch.
 * If IDs collide, local registry wins, then higher-priority providers. */
export interface NavioxProvider {
  readonly id: string;
  /** Breaks ties between similarly relevant results (higher wins). */
  readonly priority?: number;
  /** Overrides default debounce delay for this provider. */
  readonly debounceMs?: number;
  search(request: NavioxProviderRequest): NavioxProviderResponse | Promise<NavioxProviderResponse>;
}

export interface NavioxProviderRequest {
  readonly query: string;
  readonly pageId: string | null;
  readonly context: Readonly<Record<string, unknown>>;
  /** Null on initial fetch; opaque cursor from an earlier response otherwise. */
  readonly cursor: string | null;
  readonly limit: number;
  readonly signal: AbortSignal;
}

export interface NavioxProviderResponse {
  readonly items: readonly NavioxItem[];
  readonly nextCursor?: string | null;
}

export type NavioxProviderStatus = 'idle' | 'loading' | 'success' | 'error';
export interface NavioxProviderState {
  readonly status: NavioxProviderStatus;
  readonly total: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly error?: unknown;
  readonly fromCache?: boolean;
}

export interface NavioxProvidersOptions {
  readonly initial?: readonly NavioxProvider[];
  /** Default 120ms. Set to zero to search immediately. */
  readonly debounceMs?: number;
  /** Items requested per provider page; default 25. */
  readonly pageSize?: number;
  /** Only automatically query providers while open, unless enabled. */
  readonly searchWhenClosed?: boolean;
  /** Optional per-controller in-memory LRU cache. Disabled by default. */
  readonly cache?: { readonly ttlMs?: number; readonly maxEntries?: number };
}

/** Browser storage is not accessed in core; host must inject an implementation. */
export interface NavioxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NavioxPreferencesOptions {
  readonly storage?: NavioxStorage;
  readonly key?: string;
  /** Maximum recent commands, default 20. */
  readonly maxRecent?: number;
  /** Pin, favorite and recent boosts on empty queries only. Default false. */
  readonly prioritizeOnEmptyQuery?: boolean;
}

export interface NavioxVirtualOptions {
  readonly scrollOffset: number;
  readonly viewportSize: number;
  readonly estimatedItemSize: number;
  readonly overscan?: number;
}

export interface NavioxVirtualWindow<T> {
  readonly start: number;
  readonly end: number;
  readonly total: number;
  readonly totalSize: number;
  readonly paddingStart: number;
  readonly paddingEnd: number;
  readonly items: readonly T[];
}

export interface NavioxControlledState {
  readonly open: boolean;
  readonly query: string;
  readonly activeId: string | null;
}

export type NavioxChangeReason =
  | 'open' | 'close' | 'query' | 'active' | 'move' | 'select' | 'key'
  | 'page' | 'back' | 'context' | 'registry' | 'groups' | 'group-collapse' | 'sync' | 'execution' | 'progress'
  | 'providers' | 'preferences';

export interface NavioxControlledOptions {
  readonly state: NavioxControlledState;
  /** Called with requested values; parent must call syncControlledState to commit. */
  readonly onChange: (next: NavioxControlledState, reason: NavioxChangeReason) => void;
}

/** Typed, lifecycle-scoped extension registered on one Naviox controller. */
export interface NavioxExtension {
  readonly id: string;
  /** setup is synchronous; return a disposer for external listeners/resources if needed. */
  setup(api: NavioxExtensionAPI): void | (() => void);
}

export type NavioxExtensionPhase = 'state' | 'after-execute' | 'dispose';
export interface NavioxExtensionError {
  readonly extensionId: string;
  readonly phase: NavioxExtensionPhase;
  readonly error: unknown;
}
export type NavioxBeforeExecuteHook = (context: NavioxActionContext) => void | false | Promise<void | false>;
export type NavioxAfterExecuteHook = (result: NavioxExecutionResult, context: NavioxActionContext) => void | Promise<void>;

/** Only scoped registrations are exposed, so removing a plugin cleans up its resources. */
export interface NavioxExtensionAPI {
  getState(): NavioxState;
  getItems(): readonly NavioxItem[];
  setQuery(query: string): void;
  setContext(context: Readonly<Record<string, unknown>>): void;
  registerItem(item: NavioxItem): () => void;
  registerItems(items: readonly NavioxItem[]): () => void;
  registerProvider(provider: NavioxProvider): () => void;
  beforeExecute(hook: NavioxBeforeExecuteHook): () => void;
  afterExecute(hook: NavioxAfterExecuteHook): () => void;
  onStateChange(listener: NavioxListener): () => void;
  onCleanup(dispose: () => void): () => void;
}

/** Minimal fetch-like client, injected rather than taken from browser globals. */
export type NavioxHttpClient = (url: string, init: {
  readonly signal: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;
export interface NavioxHttpProviderOptions {
  readonly id: string;
  /** Absolute http(s) URL or root-relative URL. */
  readonly url: string;
  readonly client: NavioxHttpClient;
  readonly priority?: number;
  readonly debounceMs?: number;
  /** Override query parameters. Null and undefined values are omitted. */
  readonly params?: (request: NavioxProviderRequest) => Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly headers?: Readonly<Record<string, string>> | ((request: NavioxProviderRequest) => Readonly<Record<string, string>>);
  readonly mapResponse: (payload: unknown, request: NavioxProviderRequest) => NavioxProviderResponse;
}

export interface NavioxOptions {
  /** Maximum result count. Defaults to 50. */
  readonly maxResults?: number;
  /** Loop when stepping past the first/last item. Defaults to true. */
  readonly loop?: boolean;
  /** Amount moved by PageUp/PageDown. Defaults to 8. */
  readonly pageSize?: number;
  readonly search?: NavioxSearchOptions;
  readonly groups?: readonly NavioxGroup[];
  readonly providers?: NavioxProvidersOptions;
  readonly preferences?: NavioxPreferencesOptions;
  /** Extensions install after controller construction and are cleaned up on destroy. */
  readonly extensions?: readonly NavioxExtension[];
  /** Reports noncritical subscriber/after-hook/cleanup exceptions. */
  readonly onExtensionError?: (event: NavioxExtensionError) => void;
  /** Reorder visible results by group; default false for M1 compatibility. */
  readonly groupResults?: boolean;
  /** Callback for route items. No automatic window/location changes occur. */
  readonly navigate?: (item: NavioxItem, context: NavioxActionContext) => unknown | Promise<unknown>;
  readonly shortcuts?: {
    readonly toggle?: string | readonly string[];
    /** Mod means Meta on mac, Ctrl otherwise. Adapters should detect and pass it. */
    readonly platform?: 'mac' | 'other';
  };
  /** Initial state for the default (uncontrolled) mode. */
  readonly defaultOpen?: boolean;
  readonly defaultQuery?: string;
  readonly defaultActiveId?: string | null;
  /** Entire open/query/activeId triplet is externally controlled when supplied. */
  readonly controlled?: NavioxControlledOptions;
}

export interface NavioxBreadcrumb { readonly id: string; readonly title: string; }
export interface NavioxSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly NavioxItem[];
  readonly total: number;
  readonly collapsed: boolean;
}
export type NavioxExecutionStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';
export interface NavioxExecutionState {
  readonly status: NavioxExecutionStatus;
  readonly itemId: string | null;
  readonly error?: unknown;
  readonly progress?: { readonly message?: string; readonly current?: number; readonly total?: number };
}
export type NavioxExecutionResult =
  | { readonly status: 'success'; readonly item: NavioxItem; readonly value: unknown }
  | { readonly status: 'error'; readonly item: NavioxItem; readonly error: unknown }
  | { readonly status: 'cancelled'; readonly item: NavioxItem }
  | { readonly status: 'ignored'; readonly item: NavioxItem | null };
export interface NavioxActionContext {
  readonly item: NavioxItem;
  readonly query: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  reportProgress(progress: { readonly message?: string; readonly current?: number; readonly total?: number }): void;
  close(): void;
  setPage(pageId: string | null): void;
}
export interface NavioxActivationResult {
  readonly kind: 'none' | 'page' | 'selected' | 'executing';
  readonly item: NavioxItem | null;
  readonly completion?: Promise<NavioxExecutionResult>;
}
/** Framework-neutral keyboard descriptor, supplied by the host adapter. */
export interface NavioxShortcutEvent {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly targetEditable?: boolean;
}
export interface NavioxShortcutResult {
  readonly handled: boolean;
  readonly item: NavioxItem | null;
  readonly execution?: Promise<NavioxExecutionResult>;
}

export interface NavioxState extends NavioxControlledState {
  readonly results: readonly NavioxItem[];
  readonly pageId: string | null;
  readonly pageStack: readonly string[];
  readonly breadcrumbs: readonly NavioxBreadcrumb[];
  readonly sections: readonly NavioxSection[];
  readonly collapsedGroupIds: readonly string[];
  readonly execution: NavioxExecutionState;
  readonly context: Readonly<Record<string, unknown>>;
  readonly lastSelectedId: string | null;
  /** Provider status by ID; async results are merged with local items. */
  readonly providers: Readonly<Record<string, NavioxProviderState>>;
  readonly providersLoading: boolean;
  /** Count of filtered, uncollapsed results before maxResults truncation. */
  readonly totalResults: number;
  readonly recentIds: readonly string[];
  readonly favoriteIds: readonly string[];
  readonly pinnedIds: readonly string[];
}

export type NavioxListener = (state: NavioxState) => void;

export interface NavioxKeyResult {
  readonly handled: boolean;
  readonly selected: NavioxItem | null;
  readonly execution?: Promise<NavioxExecutionResult>;
}

export interface NavioxRegistry {
  getItems(): readonly NavioxItem[];
  get(id: string): NavioxItem | undefined;
  /** Register a new item. Throws for duplicate IDs. Disposer only removes its own registration. */
  register(item: NavioxItem): () => void;
  /** Atomic registration; no item is added if any ID conflicts. */
  registerMany(items: readonly NavioxItem[]): () => void;
  update(id: string, patch: Partial<Omit<NavioxItem, 'id'>>): boolean;
  unregister(id: string): boolean;
  replace(items: readonly NavioxItem[]): void;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export interface NavioxController {
  /** Install a typed extension; disposer automatically removes owned registrations. */
  use(extension: NavioxExtension): () => void;
  listExtensions(): readonly string[];
  getState(): NavioxState;
  getItems(): readonly NavioxItem[];
  getGroups(): readonly NavioxGroup[];
  getProviders(): readonly NavioxProvider[];
  registerProvider(provider: NavioxProvider): () => void;
  unregisterProvider(id: string): boolean;
  /** Force a fresh provider query. Resolves after all initial pages settle. */
  refreshProviders(): Promise<void>;
  /** Fetch the next page for one provider, if available; false when unavailable. */
  loadMore(providerId: string): Promise<boolean>;
  clearProviderCache(): void;
  setFavorite(id: string, favorite: boolean): void;
  toggleFavorite(id: string): void;
  setPinned(id: string, pinned: boolean): void;
  togglePinned(id: string): void;
  clearRecents(): void;
  subscribe(listener: NavioxListener): () => void;
  setItems(items: readonly NavioxItem[]): void;
  register(item: NavioxItem): () => void;
  registerMany(items: readonly NavioxItem[]): () => void;
  updateItem(id: string, patch: Partial<Omit<NavioxItem, 'id'>>): boolean;
  unregister(id: string): boolean;
  setGroups(groups: readonly NavioxGroup[]): void;
  setQuery(query: string): void;
  setPage(pageId: string | null): void;
  /** Enter an item-backed page or a registered legacy page scope. */
  pushPage(pageId: string): boolean;
  back(): boolean;
  setGroupCollapsed(groupId: string, collapsed: boolean): void;
  toggleGroup(groupId: string): void;
  setContext(context: Readonly<Record<string, unknown>>): void;
  /** Only valid for a controller created with options.controlled. */
  syncControlledState(state: NavioxControlledState): void;
  open(): void;
  close(): void;
  toggle(): void;
  /** Moves by delta with the configured loop policy. */
  move(delta: number): void;
  /** Moves without wrapping; intended for PageUp/PageDown. */
  jump(delta: number): void;
  setActive(id: string): void;
  /** Returns a selectable result but does not execute routes/actions. */
  select(id?: string): NavioxItem | null;
  /** Navigate on parent items, run actions, or select plain items. */
  activate(id?: string): NavioxActivationResult;
  /** Explicit action execution independent of whether the palette is open. */
  execute(id: string): Promise<NavioxExecutionResult>;
  cancelExecution(): void;
  /** Match an adapter-supplied keyboard descriptor; no DOM listeners in core. */
  handleShortcut(event: NavioxShortcutEvent): NavioxShortcutResult;
  handleKey(key: string): NavioxKeyResult;
  destroy(): void;
}
