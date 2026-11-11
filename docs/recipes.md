# Practical examples

These patterns work with plain JavaScript/TypeScript. A framework adapter can render the same controller state.

## Navigate to a page

```ts
const nav = createNaviox([
  { id: 'account', title: 'Account', href: '/account' },
], { navigate: (item) => router.push(item.href) });

nav.open();
nav.activate('account');
```

Your application supplies `router`; the core doesn't assume one.

## Add commands when a feature loads

```ts
const dispose = nav.register({
  id: 'export', title: 'Export report',
  perform: async () => exportReport(),
});

// When the feature unloads:
dispose();
```

## Use nested commands

```ts
const nav = createNaviox([
  { id: 'appearance', title: 'Appearance' },
  { id: 'light', title: 'Light', parentId: 'appearance', perform: () => setTheme('light') },
  { id: 'dark', title: 'Dark', parentId: 'appearance', perform: () => setTheme('dark') },
]);

nav.open();
nav.activate('appearance');
nav.activate('dark');
```

## Clean up

Unsubscribe listeners, dispose feature-owned registrations and call `nav.destroy()` when you no longer need a controller. For provider examples and lifecycle hooks, see [Extensions](extensions.md).
