# Naviox

**Search, commands, and navigation for any JavaScript app.**

Naviox is a small, headless TypeScript engine. It helps you build command palettes, searchable menus, quick switchers, and action-driven navigation without choosing a UI framework for you.

- **Framework-agnostic:** use it directly with JavaScript or TypeScript.
- **Flexible:** fuzzy search, keyboard shortcuts, nested pages, groups, and async providers.
- **Action-ready:** run sync/async commands, show progress, cancel stale work.
- **Extensible:** register commands, providers, and lifecycle hooks without a global plugin system.
- **Lightweight:** no runtime npm dependencies, DOM access, or forced styling.

> Current source version: `0.1.0-alpha.7`. This is a prerelease; APIs may change before 1.0. The source ZIP is not proof of npm publication.

## Install

```bash
npm install @blcklab/naviox@next
```

The `@next` selector is for the prerelease channel **after** it has been published. For projects without a UI framework, no separate adapter is needed.

## Try it

```ts
import { createNaviox } from '@blcklab/naviox';

const nav = createNaviox([
  { id: 'home', title: 'Home', href: '/' },
  { id: 'settings', title: 'Settings' },
  { id: 'theme-dark', title: 'Dark mode', parentId: 'settings',
    perform: () => console.log('Switched to dark mode') },
], {
  navigate: (item) => {
    // Use your app's router here.
    if (item.href) console.log('Go to', item.href);
  },
});

const unsubscribe = nav.subscribe((state) => {
  console.log('Results:', state.results.map((item) => item.title));
});

nav.open();
nav.setQuery('home');
nav.activate('home');

unsubscribe();
nav.destroy();
```

Naviox manages commands and state. Your application renders the UI, handles focus and routing, and decides how shortcuts are attached to the page.

## Framework components

If you want ready-made UI components, see the independently maintained `@blcklab/naviox-vue` or `@blcklab/naviox-react` packages. They are **not** included in the core repository or npm archive.

## Documentation

Start with the [documentation index](docs/index.md), or jump to [Getting started](docs/getting-started.md), [Configuration](docs/configuration.md), [API reference](docs/api.md), [Public API overview](docs/public-api.md), [Extensions](docs/extensions.md), or [Examples](docs/recipes.md).

## Development

```bash
npm install
npm run check
npm run bench:check
npm pack --dry-run
```

CI runs on Node 20, 22 and 24. Please commit the real `package-lock.json` created by npm before pushing; CI uses `npm ci`. We do not commit `dist/` or `.internal/`.

Maintainers: releases are deliberately simple. Update the version, push `master`, then push a matching `v*` tag. [Publishing guide](docs/publishing.md).

MIT · BLCK LAB
