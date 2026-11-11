# Configure Naviox

Most projects only need a list of commands and a router callback. Add advanced options when your app needs them.

## Search and navigation

```ts
import { createNaviox } from '@blcklab/naviox';

const nav = createNaviox(items, {
  maxResults: 30,
  loop: true,
  pageSize: 8,
  groups: [{ id: 'pages', title: 'Pages' }],
  navigate: (item) => yourRouter.push(item.href),
});
```

`maxResults` limits displayed results. `loop` makes arrow navigation wrap around; `pageSize` controls Page Up/Down jumps. Group metadata is optional. Your router is not included in the core.

## Shortcuts

Naviox matches portable key descriptions. It does not install a global keyboard listener. Your app decides where and when shortcuts are active. See [API reference](api.md) for the `handleShortcut` contract.

## Async providers

Add a local or remote provider when your data is not available up front. Providers receive the query, context, and an `AbortSignal`; stale results cannot replace newer ones. Use the optional debounce and cache configuration when it helps.

```ts
const stop = nav.registerProvider({
  id: 'documents',
  async search(request) {
    const response = await fetch(`/api/documents?q=${encodeURIComponent(request.query)}`, { signal: request.signal });
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    return { items: (await response.json()).items };
  },
});

// stop() unregisters the provider when it is no longer needed.
```

Validate untrusted server data before converting it to command items.

## State and cleanup

Each controller owns its items, async requests, and listeners. Keep one controller per independent search surface, or intentionally share one when the UI should share query and visibility state. Call `destroy()` when finished.

See the [complete API](api.md) for configuration types and edge cases.
