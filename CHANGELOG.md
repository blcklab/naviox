# Changelog

Notable user-facing changes to Naviox core are recorded here. For development notes and internal milestone reports, see the local `.internal/` directory (not tracked in Git).

## 0.1.0-alpha.7 — prerelease source

- Added a headless command controller with fuzzy search, item registry, groups, keyboard selection and nested pages.
- Added asynchronous command execution with progress reporting and cooperative cancellation.
- Added optional data providers with debounce, pagination, cache and stale-result protection.
- Added recents, favorites, pinned items, and a virtual-window helper.
- Added per-controller extensions, lifecycle hooks and an optional injected HTTP transport helper.
- Improved TypeScript contracts, developer documentation, tests and package verification.

This version is prepared for a first npm prerelease; presence in the source archive does **not** mean it has been published.

## Compatibility

Alpha releases may change APIs. The core has no runtime npm dependencies and is intended for JavaScript/TypeScript applications without a framework requirement.
