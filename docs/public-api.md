# Public API — Naviox core

**Package:** `@blcklab/naviox` (`0.1.0-alpha.7` source candidate). Imports must come from the root package entrypoint, not `dist/` or internal modules.

## Primary factories

| API | Purpose |
|---|---|
| `createNaviox(items, options?)` | Owns commands, providers, execution and navigation state |
| `createNavioxRegistry(items?)` | Standalone dynamic item registry |
| `createNavioxSearch(options?)` | Reusable configurable search engine |
| `createNavioxHttpProvider(options)` | HTTP transport helper using injected client |

Other helpers: `searchItems`, `rankItems`, `normalizeSearchText`, `sectionItems`, `getNavioxVirtualWindow`, `parseNavioxShortcut`, `matchesNavioxShortcut`.

## Controller families

| Concern | Methods |
|---|---|
| Visibility and search | `open`, `close`, `toggle`, `setQuery`, `getState`, `subscribe` |
| Items and groups | `register`, `registerMany`, `setItems`, `updateItem`, `unregister`, `getItems`, `getGroups`, `setGroups`, `toggleGroup` |
| Pages and selection | `setPage`, `pushPage`, `back`, `move`, `jump`, `setActive`, `select`, `activate`, `execute` |
| Actions and shortcuts | `cancelExecution`, `handleKey`, `handleShortcut` |
| Async providers | `registerProvider`, `unregisterProvider`, `refreshProviders`, `loadMore`, `clearProviderCache` |
| Preferences | `setFavorite`, `toggleFavorite`, `setPinned`, `togglePinned`, `clearRecents` |
| Extensions | `use`, `listExtensions` |
| Lifecycle | `destroy` |

`activate(id?)` returns a discriminated activation outcome (selection, page, execution, none); `execute(id)` returns a Promise of an execution result. `select(id?)` deliberately **does not** perform actions. Async work must honor its provided `signal` for cooperative cancellation.

## Types

The root entrypoint exports typed items, state, options, controller, groups, providers, preferences, action contexts/results, shortcuts, search/ranking, virtual windows, and extension lifecycle contracts. Import with `import type { NavioxItem, NavioxController, NavioxProvider, NavioxExtension } from '@blcklab/naviox'`.

See the [complete core reference](api.md) for fields and method semantics, [extensions](extensions.md) for hooks, and [compatibility](compatibility.md) for the prerelease policy.
