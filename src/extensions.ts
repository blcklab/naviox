import type {
  NavioxActionContext, NavioxAfterExecuteHook, NavioxBeforeExecuteHook, NavioxController,
  NavioxExtension, NavioxExtensionAPI, NavioxExtensionError, NavioxExtensionPhase,
  NavioxItem, NavioxProvider, NavioxState,
} from './types.js';

type Teardown = () => void;
type HookEntry<T> = { readonly scope: Scope; readonly callback: T };
interface Scope {
  readonly id: string;
  active: boolean;
  readonly cleanups: Teardown[];
}

/** Owns extension registrations, hooks, and cleanup scopes for one controller. */
export function createNavioxExtensionHost(
  getController: () => NavioxController,
  report?: (event: NavioxExtensionError) => void,
) {
  const scopes = new Map<string, Scope>();
  const before: HookEntry<NavioxBeforeExecuteHook>[] = [];
  const after: HookEntry<NavioxAfterExecuteHook>[] = [];
  let destroyed = false;

  function fault(id: string, phase: NavioxExtensionPhase, error: unknown): void {
    if (!report) return;
    try { report(Object.freeze({ extensionId: id, phase, error })); }
    catch { /* Diagnostics must never change the result of a command or cleanup. */ }
  }

  function disposeScope(scope: Scope): void {
    if (!scope.active) return;
    scope.active = false;
    if (scopes.get(scope.id) === scope) scopes.delete(scope.id);
    for (const cleanup of [...scope.cleanups].reverse()) {
      try { cleanup(); } catch (error) { fault(scope.id, 'dispose', error); }
    }
    scope.cleanups.length = 0;
  }

  function use(extension: NavioxExtension): Teardown {
    if (destroyed) throw new Error('Cannot register a Naviox extension after destroy()');
    if (!extension || typeof extension.id !== 'string' || !extension.id.trim() || typeof extension.setup !== 'function') {
      throw new TypeError('Naviox extensions require an id and setup() function');
    }
    if (scopes.has(extension.id)) throw new Error(`Duplicate Naviox extension id: ${extension.id}`);
    const scope: Scope = { id: extension.id, active: true, cleanups: [] };
    scopes.set(scope.id, scope);
    const track = (cleanup: Teardown): Teardown => {
      if (!scope.active) { cleanup(); return () => {}; }
      scope.cleanups.push(cleanup);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        const index = scope.cleanups.indexOf(cleanup);
        if (index !== -1) scope.cleanups.splice(index, 1);
        cleanup();
      };
    };
    const attach = <T>(list: HookEntry<T>[], callback: T): Teardown => {
      const entry: HookEntry<T> = { scope, callback };
      list.push(entry);
      return track(() => {
        const index = list.indexOf(entry);
        if (index !== -1) list.splice(index, 1);
      });
    };
    const api: NavioxExtensionAPI = Object.freeze({
      getState: () => getController().getState(),
      getItems: () => getController().getItems(),
      setQuery: (query: string) => getController().setQuery(query),
      setContext: (context: Readonly<Record<string, unknown>>) => getController().setContext(context),
      registerItem: (item: NavioxItem) => track(getController().register(item)),
      registerItems: (items: readonly NavioxItem[]) => track(getController().registerMany(items)),
      registerProvider: (provider: NavioxProvider) => track(getController().registerProvider(provider)),
      beforeExecute: (hook: NavioxBeforeExecuteHook) => attach(before, hook),
      afterExecute: (hook: NavioxAfterExecuteHook) => attach(after, hook),
      onStateChange: (callback: (state: NavioxState) => void) => track(getController().subscribe((state) => {
        if (!scope.active) return;
        try { callback(state); } catch (error) { fault(scope.id, 'state', error); }
      })),
      onCleanup: (cleanup: Teardown) => track(cleanup),
    });
    try {
      const cleanup = extension.setup(api);
      if (cleanup !== undefined) {
        if (typeof cleanup !== 'function') throw new TypeError('Naviox extension setup() must return a cleanup function or void');
        track(cleanup);
      }
    } catch (error) {
      disposeScope(scope); // transactionally release commands, providers, listeners, hooks
      throw error;
    }
    return () => disposeScope(scope);
  }

  return {
    use,
    list: (): readonly string[] => Object.freeze([...scopes.keys()]),
    hasBefore: () => before.length > 0,
    async runBefore(context: NavioxActionContext): Promise<boolean> {
      for (const entry of [...before]) {
        if (!entry.scope.active) continue;
        if (context.signal.aborted) return false;
        // Uninstalled extensions cannot veto a pending action after they are removed.
        let verdict: void | false;
        try { verdict = await entry.callback(context); }
        catch (error) {
          if (!entry.scope.active) continue;
          throw error; // Active precondition failure becomes an ordinary execution error.
        }
        if (!entry.scope.active) continue;
        if (verdict === false) return false;
      }
      return !context.signal.aborted;
    },
    async runAfter(result: Parameters<NavioxAfterExecuteHook>[0], context: NavioxActionContext): Promise<void> {
      for (const entry of [...after]) {
        if (!entry.scope.active) continue;
        try { await entry.callback(result, context); }
        catch (error) { fault(entry.scope.id, 'after-execute', error); }
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const scope of [...scopes.values()].reverse()) disposeScope(scope);
      before.length = 0;
      after.length = 0;
    },
  };
}
