# Extensions and HTTP integrations

Naviox core accepts **typed, synchronous extension setup functions**. Extensions add functionality to a specific controller. They do not ship with a view framework, router, storage client, transport library, or a global plugin registry.

## Install and remove an extension

```ts
import { createNaviox, type NavioxExtension } from '@blcklab/naviox';

const bookmarks: NavioxExtension = {
  id: 'bookmarks',
  setup(api) {
    api.registerItems([
      { id: 'bookmarks:open', title: 'Open bookmarks', group: 'Tools' },
      { id: 'bookmarks:sync', title: 'Sync bookmarks', closeOnExecute: false,
        perform: async ({ signal, reportProgress }) => {
          reportProgress({ message: 'Loading bookmarks' });
          await syncBookmarks({ signal }); // your own implementation
        },
      },
    ]);
    api.onStateChange((state) => {
      // Optional: observe query, page, action status, provider state, etc.
    });
    api.beforeExecute(({ item, context }) => {
      if (item.id === 'bookmarks:sync' && !context.signedIn) return false;
    });
    api.afterExecute((result) => {
      // Telemetry is optional; errors here do not change the command result.
    });
    return () => { /* Unsubscribe external non-Naviox resources here. */ };
  },
};

const nav = createNaviox([], {
  onExtensionError: (event) => console.warn(event.extensionId, event.phase, event.error),
});
const uninstall = nav.use(bookmarks);
console.log(nav.listExtensions()); // ['bookmarks']
uninstall(); // unregisters the commands, listeners, hooks and providers it installed
nav.destroy();
```

`options.extensions` is an alternative for initial registration: `createNaviox([], { extensions: [bookmarks] })`.

### Exact lifecycle semantics

- Every extension needs a **unique nonempty id** per controller. Plugins with the same id can coexist on separate controllers.
- `setup(api)` executes synchronously, exactly once per installation. It may return a cleanup function or `void`; async setup is not supported. For async work, register an async search provider or start host-managed work with a cleanup and an `AbortController`.
- Registry and provider registrations, subscriptions and hooks made through the extension API are **scoped**. They are unregistered in reverse order on uninstall or controller destruction. Manual disposers are idempotent. On a thrown setup error, scoped registrations are rolled back and the error rethrown.
- The core registry intentionally uses identity-safe cleanup: if a host subsequently **replaces or updates** an extension-owned item outside its scope, the old registration disposer will not delete that new item. Use the extension API for initial commands; remove/replace items explicitly when ownership changes.
- `beforeExecute(context)` hooks run in installation/registration order. Returning **`false`** cancels execution and publishes `status: 'cancelled'`. Throwing or rejecting publishes an **execution error**. Hooks receive the command's `AbortSignal` and must cooperate with cancellation for long-running checks.
- `afterExecute(result, context)` hooks run in order for commands which settle normally (success, veto, or handler error). Errors in these observers do **not** replace the command result; they go to `onExtensionError` if configured.
- State listeners and teardown failures are isolated and optionally reported via `onExtensionError`. Errors thrown by the diagnostics callback are ignored to protect the engine.
- A command superseded/cancelled while awaiting asynchronous work may return `cancelled` without running post-hooks. Hooks should not assume that every started action emits a completion observer event.
- Install/uninstall after `destroy()` is not supported. Installation after destroy throws; calling an existing disposer again is safe.
- The core **never** creates global event listeners or network clients. Extensions supply their own implementations and cleanup.

### Scoped extension API

| Method | Purpose |
| --- | --- |
| `registerItem`, `registerItems` | Contribute local commands/pages; scoped disposal |
| `registerProvider` | Contribute async data source; abort and unregister on removal |
| `beforeExecute`, `afterExecute` | Execution preconditions, instrumentation and after-observers |
| `onStateChange` | Observe snapshot changes; unsubscribe automatically |
| `onCleanup` | Own external event listeners, timers, observers, etc. |
| `getState`, `getItems`, `setQuery`, `setContext` | Read state and drive public navigation context |

## Optional HTTP provider helper

Use `createNavioxHttpProvider` only when the host wants a fetch-style transport. **You must inject a client.** Naviox never calls global `fetch()` on your behalf.

```ts
import { createNaviox, createNavioxHttpProvider } from '@blcklab/naviox';

const httpDocs = createNavioxHttpProvider({
  id: 'remote-docs',
  url: '/api/search',
  debounceMs: 120,
  client: (url, { signal, headers }) => fetch(url, { signal, headers }),
  headers: () => ({ Accept: 'application/json' }),
  params: ({ query, cursor, limit }) => ({ q: query, cursor, limit }),
  mapResponse: (body) => {
    // Validate untrusted JSON with your app's schema/validator before mapping.
    const payload = body as { documents: { id: string; title: string }[]; cursor?: string };
    return {
      items: payload.documents.map((doc) => ({ id: `docs:${doc.id}`, title: doc.title })),
      nextCursor: payload.cursor ?? null,
    };
  },
});

const nav = createNaviox([], {
  providers: { initial: [httpDocs], cache: { ttlMs: 30_000 } },
});
```

Default URL parameters (when `params` is omitted): `q`, `limit`, `cursor`, and `pageId` (null values omitted). The search context is **never** serialized by default; pass explicit non-sensitive values when needed. Root-relative and absolute `http(s)` URLs are accepted; prefer HTTPS for production. Credentials embedded in URLs and protocol-relative URLs are rejected. HTTP errors surface via the existing per-provider error state. Abort signals flow directly through your injected client, and stale results are still protected by the M3 provider manager.

**Security:** `mapResponse` receives untrusted parsed JSON; validate it and only expose trusted item content. Never embed secrets in query strings. Browser access, authentication tokens, rate limits and cross-origin permissions remain application responsibilities.

## Architecture notes

`extensions.ts` manages per-instance scopes and hooks. `http-provider.ts` only adapts network requests to the existing provider contract. UI adapters can use `controller.use()` without adopting new state shape or importing implementation details. There are no additional npm packages or framework dependencies.

See the [API reference](api.md) for the complete core surface and [Getting started](getting-started.md) for a simpler introduction.
