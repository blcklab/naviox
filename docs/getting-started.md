# Getting started

Naviox is a command engine, not a premade search dialog. You supply commands; Naviox filters and executes them; your application decides what to render.

## 1. Install the core

```bash
npm install @blcklab/naviox@next
```

Use `@next` for the alpha channel after the package is published.

## 2. Add a few commands

```ts
import { createNaviox } from '@blcklab/naviox';

const nav = createNaviox([
  { id: 'home', title: 'Home', href: '/', group: 'Pages' },
  { id: 'projects', title: 'Projects', href: '/projects', group: 'Pages' },
  { id: 'settings', title: 'Settings' },
  { id: 'dark', title: 'Dark mode', parentId: 'settings',
    perform() { console.log('Enable dark mode'); } },
], {
  navigate(item) {
    // Call your own router here.
    console.log('Navigate to', item.href);
  },
});
```

An item needs an `id` and a `title`. Use `href` for page links, `perform` for actions, and `parentId` for nested pages.

## 3. Search and react to state

```ts
const unsubscribe = nav.subscribe((state) => {
  console.log(state.query, state.results);
});

nav.open();
nav.setQuery('proj');
nav.activate('projects');

// Clean up when your component or app unmounts.
unsubscribe();
nav.destroy();
```

`select()` records a choice without executing it. `activate()` follows the item's usual behavior. `execute(id)` runs a registered action, even if the palette is closed.

## 4. Connect a UI

Listen to the controller state and render `state.results` however you like. Wire keyboard events to the controller's navigation APIs, and own your DOM focus, dialog behavior, and routes. Naviox never adds document listeners itself.

For ready-made UI, use the separate Vue or React adapter package.

See [Configuration](configuration.md), [API reference](api.md), and [Examples](recipes.md) for the next steps.
