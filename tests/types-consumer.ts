import {
  createNaviox, createNavioxRegistry, createNavioxSearch, createNavioxHttpProvider, rankItems,
  type NavioxControlledState, type NavioxCommandItem, type NavioxRouteItem, type NavioxItem, type NavioxState,
  type NavioxExecutionResult, type NavioxShortcutEvent, matchesNavioxShortcut,
} from '../src/index.js';

const items: readonly NavioxItem[] = [{ id: 'home', title: 'Home', aliases: ['start'] }];
const command: NavioxCommandItem = { id: "a", title: "Command", kind: "command" };
const route: NavioxRouteItem = { id: "b", title: "Route", kind: "route", href: "/" };
void command; void route;
const registry = createNavioxRegistry(items);
const search = createNavioxSearch({ score: (_item, _query, tokens) => tokens.length });
const ranked = rankItems(registry.getItems(), 'home');
const matched: readonly NavioxItem[] = search.search(items, 'home');
const controlled: NavioxControlledState = { open: false, query: '', activeId: null };
const controller = createNaviox(items, {
  controlled: { state: controlled, onChange(next, reason) { void next.open; void reason; } },
  search: { weights: { aliases: 3 }, filter(item, context) { return !!item.title && context.admin !== false; } },
});
const snapshot: NavioxState = controller.getState();
void matched; void ranked; void snapshot;
// @ts-expect-error State snapshots are readonly, never mutable via consumer code.
snapshot.open = true;
// @ts-expect-error Naviox items require an id.
const malformed: NavioxItem = { title: 'Missing id' };
void malformed;
controller.destroy();

const actions = createNaviox([
  { id: 'settings', title: 'Settings' },
  { id: 'theme', title: 'Theme', parentId: 'settings', shortcuts: ['Mod+T'],
    perform: async ({ reportProgress, signal, close }) => {
      reportProgress({ message: 'Working', current: 1, total: 2 });
      if (!signal.aborted) close();
      return 'ok';
    },
  },
], { shortcuts: { platform: 'mac' }, groupResults: true });
const event: NavioxShortcutEvent = { key: 't', metaKey: true };
const matches: boolean = matchesNavioxShortcut('Mod+T', event, 'mac');
void matches;
const result: Promise<NavioxExecutionResult> = actions.execute('theme');
void result;
const activated = actions.activate('settings');
void activated.completion;
const breadcrumbs = actions.getState().breadcrumbs;
void breadcrumbs;
actions.destroy();

// M7: framework-neutral extension setup, optional execution hooks and injected HTTP search.
const pluginHost = createNaviox([], {
  onExtensionError(error) { void error.extensionId; void error.phase; },
  extensions: [{ id: 'audit', setup(api) {
    api.registerItem({ id: 'audit:open', title: 'Open audit', perform: () => true });
    api.beforeExecute(async (context) => {
      // Optional veto; no browser/API global is required.
      if (context.item.disabled) return false;
    });
    api.afterExecute((result, context) => { void result.status; void context.signal; });
    api.onStateChange((state) => { void state.query; });
  } }],
});
const stopPlugin = pluginHost.use({ id: 'remote', setup(api) {
  api.registerProvider(createNavioxHttpProvider({
    id: 'docs', url: '/api/search',
    client: async (_url, _init) => ({ ok: true, status: 200, json: async () => ({ items: [] }) }),
    mapResponse(payload, _request) {
      // Application validates/decodes unknown HTTP payloads.
      return { items: (payload as { items: NavioxItem[] }).items };
    },
  }));
} });
const installedNames: readonly string[] = pluginHost.listExtensions();
void installedNames;
stopPlugin();
pluginHost.destroy();
