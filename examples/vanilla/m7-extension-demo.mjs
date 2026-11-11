/** Node 20+ runnable, no DOM or network: npm run build && node examples/vanilla/m7-extension-demo.mjs */
import { createNaviox, createNavioxHttpProvider } from '../../dist/index.js';

const mockClient = async (url, { signal }) => {
  if (signal.aborted) throw new Error('aborted');
  console.log('Host-provided search transport:', url);
  return {
    ok: true, status: 200,
    json: async () => ({ documents: [{ id: 'guide', title: 'Naviox integration guide' }] }),
  };
};

const nav = createNaviox([], { providers: { debounceMs: 0 }, defaultOpen: true });
const uninstall = nav.use({
  id: 'docs-integration',
  setup(api) {
    api.registerItem({ id: 'docs:help', title: 'Help', closeOnExecute: false,
      perform: () => 'Opened help',
    });
    api.registerProvider(createNavioxHttpProvider({
      id: 'docs', url: 'https://example.org/search', client: mockClient,
      mapResponse: (payload) => ({ items: payload.documents.map((doc) => ({
        id: `docs:${doc.id}`, title: doc.title,
      })) }),
    }));
    api.beforeExecute(({ item }) => { console.log('Executing:', item.id); });
    api.afterExecute((result) => { console.log('Finished:', result.status); });
  },
});

await nav.refreshProviders();
console.log('Results:', nav.getState().results.map((item) => item.title));
await nav.execute('docs:help');
uninstall();
console.log('After removal:', nav.getItems().length, 'items /', nav.getProviders().length, 'providers');
nav.destroy();
