# How Naviox works

Naviox separates **what a command does** from **how a command menu looks**.

1. **Registry:** holds your commands and lets you add or remove them at runtime.
2. **Search:** ranks matching commands, including titles, keywords, and aliases.
3. **Controller:** owns the current query, page, selection, and running action.
4. **Providers:** optionally supply results from elsewhere, with cancellation and caching.
5. **Extensions:** register extra commands or hooks and clean them up together.

The core contains no Vue, React, DOM rendering, router, or CSS framework. You can use it with plain JavaScript/TypeScript, or add an independently published framework adapter for a ready-made interface.

Every controller is independent by default. That makes it easier to embed several search experiences without sharing hidden global state.

For implementation details, browse the TypeScript declarations or use the [API reference](api.md). For common setups, see [Getting started](getting-started.md).
