# Naviox API reference

The **public entrypoint** is `@blcklab/naviox`. No imports from internal paths are required. The API is alpha and may evolve before 1.0.

## Creating a controller

```ts
import { createNaviox } from '@blcklab/naviox';
const nav = createNaviox(items, {
  maxResults: 50,               // visible rows, not collapsed/disabled-group matches
  loop: true,
  pageSize: 8,
  groupResults: false,          // preserve M1 global relevance/source order by default
  groups: [{ id: 'projects', title: 'My projects', order: 10, defaultCollapsed: false }],
  shortcuts: { platform: 'mac', toggle: 'Mod+K' },
  navigate: (item, context) => console.log('handle URL', item.href, context.signal),
});
```

`NavioxItem` includes `id` and `title`, plus optional `description`, `kind`, `group`, `href`, `keywords`, `aliases`, `priority`, `disabled`, `readOnly`, `hidden`, `preview`, `pageId` (legacy page scope), `parentId` (nested item page), `perform`, `shortcuts`, `shortcutScope`, and `closeOnExecute`.

```ts
const nav = createNaviox([
  { id: 'settings', title: 'Settings' },
  { id: 'theme', title: 'Theme', parentId: 'settings' },
  { id: 'dark', title: 'Dark', parentId: 'theme',
    perform: async ({ item, query, context, signal, reportProgress, close, setPage }) => {
      reportProgress({ message: 'Changing appearance…', current: 1, total: 2 });
      // In a real action, give signal to fetch or your cancellable operation.
      return 'dark';
    },
  },
]);
```

### State

`nav.getState()` returns an immutable snapshot:

- `open`, `query`, `activeId`, `results`, `pageId`, `context`, `lastSelectedId`
- `pageStack: string[]`, `breadcrumbs: {id,title}[]`
- `sections: {id,title,items,total,collapsed}[]`, `collapsedGroupIds: string[]`
- `execution: {status, itemId, error?, progress?}`
- `providers`, `providersLoading`, `totalResults`
- `recentIds`, `favoriteIds`, `pinnedIds`

`execution.status` is `idle | running | success | error | cancelled`. Error and result values come from user handlers; the core does not serialize them or invent status messages.

### Core methods

| Method | Purpose |
| --- | --- |
| `getItems()`, `setItems(items)` | Read or atomically replace the registry |
| `register(item)`, `registerMany(items)` | Add items; returns owned registration disposer |
| `updateItem(id, patch)`, `unregister(id)` | Dynamic command changes |
| `getGroups()`, `setGroups(groups)` | Read/update optional group metadata |
| `setGroupCollapsed(id, bool)`, `toggleGroup(id)` | Hide/show results in a group |
| `setQuery(query)`, `setContext(context)` | Search and contextual filtering |
| `setPage(id|null)` | Jump to a page (legacy compatibility), clears query |
| `pushPage(id)`, `back()` | Nested navigation; return `boolean` |
| `open()`, `close()`, `toggle()` | Palette visibility lifecycle |
| `move(delta)`, `jump(delta)`, `setActive(id)` | Keyboard selection |
| `select(id?)` | **M1-compatible** data-only selection; closes, does not run action |
| `activate(id?)` | Navigate into a child page, execute an action, or select plain item |
| `execute(id)` | Run a registered action directly; returns a Promise result |
| `cancelExecution()` | Abort current action and publish cancelled state |
| `handleKey(key)` | Core keyboard navigation and Enter activation |
| `handleShortcut(event)` | Match portable keyboard descriptor; toggle, execute, or return an item |
| `subscribe(listener)` | Notify on state transitions; returns unsubscribe |
| `syncControlledState(value)` | Parent commits `{open,query,activeId}` in controlled mode |
| `getProviders()`, `registerProvider(provider)`, `unregisterProvider(id)` | Per-controller dynamic data-source registry |
| `refreshProviders()` | Refresh initial pages, bypass cache and debounce |
| `loadMore(providerId)` | Fetch next opaque-cursor page; resolves `boolean` |
| `clearProviderCache()` | Clear per-controller in-memory LRU cache |
| `setFavorite(id, value)`, `toggleFavorite(id)` | Preference mutations |
| `setPinned(id, value)`, `togglePinned(id)` | Optional priority marks |
| `clearRecents()` | Reset recently used command list |
| `destroy()` | Abort and release all owned subscriptions, timers and catalog |

### Choosing an action

`activate()` returns `{kind, item, completion?}`, where `kind` is `none`, `page`, `selected`, or `executing`. If `executing`, await `completion` for a `NavioxExecutionResult`.

`execute(id)` resolves to one of:

- `{ status: 'success', item, value }`
- `{ status: 'error', item, error }`
- `{ status: 'cancelled', item }`
- `{ status: 'ignored', item }` for unrecognized, disallowed or non-executable items

**Synchronous throws and Promise rejections are captured**, not thrown by `execute`. If a newer action starts, the old `AbortSignal` is aborted and its stale result cannot override the new run. Cancellation is *cooperative*: callbacks should check `signal.aborted` or pass it to APIs like `fetch`; Naviox cannot forcibly stop arbitrary work. Destroying the controller aborts its running action.

Actions close the palette **after success** by default. Set `closeOnExecute: false` to keep it open. Errors keep it open. An action may call its context's `close()` without being marked cancelled. Calling the controller's `close()` while work is running instead cancels that work.

### Nested pages and keys

Add `parentId` on a child, referring to the parent's `id`. A visible item with children opens a new page on activation. `pageStack` and `breadcrumbs` reflect navigation. `setPage('legacy')` still supports previously registered `pageId: 'legacy'` items. Missing page titles fall back to the page ID when a parent was removed.

- `ArrowUp`, `ArrowDown`, `Home`, `End`, `PageUp`, `PageDown`: move
- `Enter`: activate current row (navigation, action or data selection)
- `Escape`: back one page, or close from the root
- `Backspace`: back only with an empty query
- `Alt+ArrowLeft`: back

A browser UI adapter must pass the appropriate key, call `preventDefault()` for `handled`, and provide keyboard focus and ARIA itself.

### Shortcut matching (no browser globals)

```ts
import { matchesNavioxShortcut } from '@blcklab/naviox';
const match = matchesNavioxShortcut('Mod+K', {
  key: 'k', metaKey: true, ctrlKey: false,
  altKey: false, shiftKey: false, targetEditable: false,
}, 'mac');
```

`Mod` means Meta on macOS and Ctrl on other platforms. The **adapter supplies the platform**, since the core must not inspect `navigator`. `NavioxShortcutEvent` accepts `key`, modifier booleans, and optional `repeat`, `isComposing`, `targetEditable`. Repeated/composing keys are ignored; plain letter shortcuts are ignored in editable controls. The input does **not** register or attach keyboard listeners. Single-stroke chords only; no multi-step sequences in M2.

`nav.handleShortcut(event)` returns `{ handled, item, execution? }`. Item shortcuts are global by default, with `shortcutScope: 'page'` to constrain them to their declared scope. If duplicate shortcuts match, higher `priority` wins, with source-order ties. Palette toggle bindings take precedence. `handled` indicates the adapter may prevent default; if an item has no action callback, the host receives it as data.

### Group projection

`getState().sections` groups the visible matches with titles, counts and collapsed state. With `groupResults: false` (default), `results` retains M1 relevance order and may interleave groups; use `groupResults: true` when rendering entire sections to ensure their flattened order agrees with keyboard focus traversal. The `defaultCollapsed` group setting is applied on creation and to newly registered group metadata. Collapsed sections retain a total match count, while collapsed items are excluded from `results` and selection. Group IDs not explicitly registered are permitted.

### Registry and search

All M1 APIs remain available: `createNavioxRegistry`, `createNavioxSearch`, `rankItems`, `searchItems`, `normalizeSearchText`. Customize `search.weights`, `score`, `filter` and `compare` through `createNaviox` options. Disabled items can be displayed but not focused; read-only items can be focused but not selected or run; hidden and disabled-group items are excluded. Cloning/freezing covers `keywords`, `aliases`, `shortcuts`, and preview metadata; custom nested objects are not deep-cloned.

### Controlled mode

Pass `controlled: {state:{open,query,activeId}, onChange(next,reason) }`. The parent owns all three controls; call `nav.syncControlledState(next)` when the parent commits. Page stack, context, groups and execution lifecycle remain internally controlled. See M1 tests for detailed behavior. This is one coherent control contract, not three independent partial controls.

## M3 provider API

```ts
const nav = createNaviox([{ id: 'home', title: 'Home' }], {
  providers: {
    debounceMs: 150,        // default 120; provider.debounceMs can override it
    pageSize: 25,
    searchWhenClosed: false, // default
    cache: { ttlMs: 30_000, maxEntries: 50 }, // explicitly enabled, memory only
    initial: [{
      id: 'docs',
      priority: 2,
      async search({ query, pageId, context, cursor, limit, signal }) {
        return { items: [{ id: 'doc-a', title: 'Document A' }], nextCursor: null };
      },
    }],
  },
});
```

A provider may return synchronously or asynchronously. The response must be `{ items: NavioxItem[], nextCursor?: string | null }`. The controller owns `AbortSignal` and cancels superseded queries, page/context transitions, closes and destruction. Stale responses are rejected even if a provider ignores cancellation. Providers can opt into their own `debounceMs`.

`getState().providers` is an immutable ID-to-state map with `status: idle | loading | success | error`, `total`, `hasMore`, `nextCursor`, optional `error`, and optional `fromCache`. `providersLoading` is true while any provider is awaiting or debounce-scheduled. A failed provider does not block local results or other providers. `refreshProviders()` bypasses cache and debounce and resolves after initial pages finish, including errors. `loadMore(id)` retrieves one next page, and returns false on no-more/error/in-flight, while preserving already loaded data. A repeated cursor ends pagination.

The **local registry** remains authoritative for `getItems()` and mutations; remote providers feed the result projection but do not replace local commands. Duplicate IDs prefer local registration, then the higher-priority provider. When search text is present, relevance ranks before source priority. Provider results for nested pages are scoped to the page that requested them; when `parentId`/`pageId` are omitted, Naviox applies the requested page scope automatically.

Cache is disabled unless `providers.cache` is provided. It uses a per-instance in-memory LRU and TTL (defaults 60 seconds / 100 entries when enabled). Query/page/cursor are part of the key; on context change the cache clears so response data cannot leak across contexts. `refreshProviders()` always issues a fresh request.

## M3 preferences

```ts
const nav = createNaviox(items, {
  preferences: {
    storage: window.localStorage, // provide this in browser code, not in core
    key: 'my-app:naviox', maxRecent: 20,
    prioritizeOnEmptyQuery: true,
  },
});
nav.setFavorite('about', true);
nav.togglePinned('naviox');
nav.clearRecents();
```

The host injects a synchronous `getItem`/`setItem` storage adapter (also works with custom JS storage); the core never reads `window`/`localStorage`. Storage errors and malformed JSON are ignored safely. `recentIds` records **successful executions and data selections**, not failed actions. Enabling `preferences` is necessary for automatic recents. Sorting boosts are opt-in and apply only with empty queries, preserving relevant fuzzy matching.

## M3 virtual window

```ts
import { getNavioxVirtualWindow } from '@blcklab/naviox';
const windowModel = getNavioxVirtualWindow(items, {
  scrollOffset: 1200, viewportSize: 400, estimatedItemSize: 36, overscan: 4,
});
// { start, end, total, totalSize, paddingStart, paddingEnd, items }
```

The helper returns an immutable overscanned slice and fixed-size spacer estimates. It does **not** attach scroll listeners or manage DOM measurements, keyboard focus, row heights or ARIA. Your UI adapter is responsible for those concerns. Set `maxResults` high enough in the controller when you intend to window through a large result list.

## Still future scope

Production-grade Vue/React renderers, accessible focus trap and dialog primitives, cross-browser/a11y QA, built-in dynamic-height virtualization and the rich mega-menu UI are not shipped in M3. They are planned for M4–M8.

## M7 extension and integration APIs

- `controller.use(extension: NavioxExtension): () => void`: install a typed, per-controller extension; returns an idempotent disposer.
- `controller.listExtensions(): readonly string[]`: inspect installed IDs.
- `options.extensions?: readonly NavioxExtension[]`: install extensions when a controller is created.
- `options.onExtensionError?: (event: NavioxExtensionError) => void`: receive nonfatal observer/post-hook/cleanup errors.
- Extension setup `api`: `getState`, `getItems`, `setQuery`, `setContext`, `registerItem`, `registerItems`, `registerProvider`, `beforeExecute`, `afterExecute`, `onStateChange`, `onCleanup`.
- `createNavioxHttpProvider(options: NavioxHttpProviderOptions): NavioxProvider`: optional fetch-style remote adapter, using the host's own client, explicit JSON mapping and the existing M3 cache/debounce/cancellation model.

**`select()` remains data-only.** Hooks apply to `execute()` (including execution through `activate()`/shortcuts), not data selection. A pre-execution `false` cancels the action; a thrown prehook produces an execution error. Posthook failures do not overwrite the action's result. Extensions clean up only the registrations/subscriptions they own. See [extensions.md](extensions.md) for complete examples and lifecycle details.
