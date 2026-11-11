import test from 'node:test';
import assert from 'node:assert/strict';
import { createNaviox, getNavioxVirtualWindow } from '@blcklab/naviox';

const ids = (nav) => nav.getState().results.map((item) => item.id);
const sleep = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
}

test('initial providers start on open and merge into local results without mutating registry', async () => {
  let requests = 0;
  const nav = createNaviox([{ id: 'local', title: 'Local' }], {
    providers: { debounceMs: 0, initial: [{ id: 'remote', search: async () => {
      requests++; return { items: [{ id: 'remote-1', title: 'Remote' }] };
    } }] },
  });
  assert.equal(requests, 0);
  nav.open();
  await sleep();
  assert.deepEqual(ids(nav), ['local', 'remote-1']);
  assert.deepEqual(nav.getItems().map((i) => i.id), ['local']);
  assert.equal(nav.getState().providers.remote.status, 'success');
  assert.equal(nav.getState().providersLoading, false);
  assert.equal(nav.getState().totalResults, 2);
  nav.destroy();
});

test('provider race: stale response never appears after query changes', async () => {
  const requests = new Map();
  const aborted = [];
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'search', search: (request) => {
    aborted.push(request.signal);
    const d = deferred(); requests.set(request.query, d); return d.promise;
  } }] } });
  nav.setQuery('old');
  nav.setQuery('new');
  assert.equal(aborted[0].aborted, true);
  assert.equal(aborted[1].aborted, true);
  requests.get('new').resolve({ items: [{ id: 'new', title: 'New' }] });
  await sleep();
  assert.deepEqual(ids(nav), ['new']);
  requests.get('old').resolve({ items: [{ id: 'old', title: 'Old' }] });
  await sleep();
  assert.deepEqual(ids(nav), ['new']);
  nav.destroy();
});

test('old provider data does not appear during query transitions, even before debounce fires', async () => {
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: ({ query }) => ({
    items: [{ id: query || 'initial', title: query || 'initial' }],
  }) }] } });
  await sleep();
  assert.deepEqual(ids(nav), ['initial']);
  const events = [];
  nav.subscribe((state) => events.push([state.query, state.results.map((x) => x.id)]));
  nav.setQuery('else');
  assert.deepEqual(events[0], ['else', []]);
  await sleep();
  assert.deepEqual(ids(nav), ['else']);
  nav.destroy();
});

test('debounce collapses rapid search changes into one provider call', async () => {
  const calls = [];
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 30, initial: [{ id: 'p', search: ({ query }) => {
    calls.push(query); return { items: [{ id: 'x', title: query }] };
  } }] } });
  nav.setQuery('a'); nav.setQuery('ab'); nav.setQuery('abc');
  await sleep(55);
  assert.deepEqual(calls, ['abc']);
  nav.destroy();
});

test('close cancels pending provider work and reopening fetches latest query', async () => {
  let firstSignal, count = 0;
  const pending = deferred();
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: ({ signal }) => {
    count++; if (count === 1) { firstSignal = signal; return pending.promise; }
    return { items: [{ id: 'again', title: 'Again' }] };
  } }] } });
  nav.close();
  assert.equal(firstSignal.aborted, true);
  pending.resolve({ items: [{ id: 'stale', title: 'Stale' }] });
  await sleep();
  assert.equal(ids(nav).includes('stale'), false);
  nav.open();
  await sleep();
  assert.deepEqual(ids(nav), ['again']);
  nav.destroy();
});

test('pagination and deduplication: nextCursor advances and loadMore stops at end', async () => {
  const cursors = [];
  const nav = createNaviox([], { providers: { initial: [{ id: 'p', search: ({ cursor, limit }) => {
    cursors.push([cursor, limit]);
    if (cursor === null) return { items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], nextCursor: '2' };
    return { items: [{ id: 'b', title: 'Duplicate' }, { id: 'c', title: 'C' }] };
  } }], debounceMs: 0, pageSize: 2 }, defaultOpen: true });
  await sleep();
  assert.equal(nav.getState().providers.p.hasMore, true);
  assert.equal(await nav.loadMore('p'), true);
  assert.deepEqual(ids(nav), ['a', 'b', 'c']);
  assert.deepEqual(cursors, [[null, 2], ['2', 2]]);
  assert.equal(nav.getState().providers.p.hasMore, false);
  assert.equal(await nav.loadMore('p'), false);
  nav.destroy();
});

test('pagination errors retain earlier results and allow retry', async () => {
  let failed = false;
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: ({ cursor }) => {
    if (!cursor) return { items: [{ id: 'a', title: 'A' }], nextCursor: 'next' };
    if (!failed) { failed = true; throw new Error('offline'); }
    return { items: [{ id: 'b', title: 'B' }] };
  } }] } });
  await sleep();
  assert.equal(await nav.loadMore('p'), false);
  assert.deepEqual(ids(nav), ['a']);
  assert.equal(nav.getState().providers.p.status, 'error');
  assert.equal(nav.getState().providers.p.hasMore, true);
  assert.equal(await nav.loadMore('p'), true);
  assert.deepEqual(ids(nav), ['a', 'b']);
  nav.destroy();
});

test('same cursor never produces an infinite pagination loop', async () => {
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: ({ cursor }) => ({
    items: [{ id: cursor ?? 'a', title: cursor ?? 'a' }], nextCursor: 'repeat',
  }) }] } });
  await sleep();
  assert.equal(await nav.loadMore('p'), true);
  assert.equal(nav.getState().providers.p.hasMore, false);
  nav.destroy();
});

test('provider failures surface in state, and refresh retries without rejecting', async () => {
  let fail = true;
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'api', search: () => {
    if (fail) throw new Error('disconnected'); return { items: [{ id: 'restored', title: 'Restored' }] };
  } }] } });
  await sleep();
  assert.equal(nav.getState().providers.api.status, 'error');
  assert.match(nav.getState().providers.api.error.message, /disconnected/);
  fail = false;
  await nav.refreshProviders();
  assert.equal(nav.getState().providers.api.status, 'success');
  assert.deepEqual(ids(nav), ['restored']);
  nav.destroy();
});

test('in-memory TTL cache reuses previous query; explicit refresh bypasses it', async () => {
  let calls = 0;
  const nav = createNaviox([], { defaultOpen: true, providers: {
    debounceMs: 0, cache: { ttlMs: 2000, maxEntries: 3 }, initial: [{ id: 'p', search: ({ query }) => {
      calls++; return { items: [{ id: query || 'root', title: query || 'Root' }] };
    } }],
  } });
  await sleep();
  nav.setQuery('x'); await sleep();
  nav.setQuery(''); await sleep();
  assert.equal(calls, 2);
  assert.equal(nav.getState().providers.p.fromCache, true);
  await nav.refreshProviders();
  assert.equal(calls, 3);
  assert.equal(nav.getState().providers.p.fromCache, false);
  nav.destroy();
});

test('context changes invalidate cached data and requests receive the new context', async () => {
  const observed = [];
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, cache: {}, initial: [{ id: 'p', search: ({ context }) => {
    observed.push(context.tenant ?? 'anonymous'); return { items: [{ id: 'a', title: String(context.tenant ?? 'anonymous') }] };
  } }] } });
  await sleep();
  nav.setContext({ tenant: 'a' }); await sleep();
  nav.setContext({ tenant: 'b' }); await sleep();
  assert.deepEqual(observed, ['anonymous', 'a', 'b']);
  assert.equal(nav.getState().results[0].title, 'b');
  nav.destroy();
});

test('nested provider search assigns current page scope to results', async () => {
  const nav = createNaviox([{ id: 'settings', title: 'Settings' }, { id: 'local-child', title: 'Local child', parentId: 'settings' }], {
    defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: ({ pageId }) => ({
      items: [{ id: pageId ? 'remote-child' : 'remote-root', title: 'Remote' }],
    }) }] },
  });
  await sleep();
  assert.deepEqual(ids(nav), ['settings', 'remote-root']);
  nav.pushPage('settings');
  await sleep();
  assert.deepEqual(ids(nav), ['local-child', 'remote-child']);
  nav.destroy();
});

test('local item wins ID collision and source priority breaks ties', async () => {
  const nav = createNaviox([{ id: 'x', title: 'Local' }], { defaultOpen: true, providers: { debounceMs: 0, initial: [
    { id: 'low', priority: 1, search: () => ({ items: [{ id: 'dupe', title: 'Provider low' }, { id: 'x', title: 'Should lose' }] }) },
    { id: 'high', priority: 10, search: () => ({ items: [{ id: 'dupe', title: 'Provider high' }, { id: 'high', title: 'Remote high' }] }) },
  ] } });
  await sleep();
  assert.equal(nav.getState().results.find((v) => v.id === 'x').title, 'Local');
  assert.equal(nav.getState().results.find((v) => v.id === 'dupe').title, 'Provider high');
  assert.deepEqual(ids(nav), ['dupe', 'high', 'x']);
  nav.destroy();
});

test('provider items with actions can execute without registry registration', async () => {
  let calls = 0;
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: () => ({ items: [
    { id: 'remote-action', title: 'Remote action', perform: () => ++calls },
  ] }) }] } });
  await sleep();
  assert.equal((await nav.execute('remote-action')).status, 'success');
  assert.equal(calls, 1);
  nav.destroy();
});

test('invalid provider payload produces a provider error without breaking local commands', async () => {
  const nav = createNaviox([{ id: 'local', title: 'Local' }], { defaultOpen: true, providers: { debounceMs: 0, initial: [
    { id: 'broken', search: () => ({ invalid: true }) },
  ] } });
  await sleep();
  assert.deepEqual(ids(nav), ['local']);
  assert.equal(nav.getState().providers.broken.status, 'error');
  nav.destroy();
});

test('dynamic provider registrations have safe scoped disposers and reject duplicates', async () => {
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0 } });
  const dispose = nav.registerProvider({ id: 'new', search: () => ({ items: [{ id: 'a', title: 'A' }] }) });
  assert.throws(() => nav.registerProvider({ id: 'new', search: () => ({ items: [] }) }), /Duplicate/);
  await sleep();
  assert.deepEqual(ids(nav), ['a']);
  assert.equal(nav.getProviders().length, 1);
  dispose();
  assert.deepEqual(ids(nav), []);
  assert.equal(nav.unregisterProvider('new'), false);
  nav.destroy();
});

test('destroy aborts in-flight requests and does not publish late states', async () => {
  const task = deferred();
  let signal;
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [{ id: 'p', search: (request) => {
    signal = request.signal; return task.promise;
  } }] } });
  let notifications = 0;
  nav.subscribe(() => notifications++);
  nav.destroy();
  assert.equal(signal.aborted, true);
  const before = notifications;
  task.resolve({ items: [{ id: 'late', title: 'Late' }] });
  await sleep();
  assert.equal(notifications, before);
});

test('preferences are stored with injected storage and restored in a new instance', async () => {
  const storage = memoryStorage();
  const opts = { preferences: { storage, maxRecent: 2, prioritizeOnEmptyQuery: true } };
  const commands = [
    { id: 'a', title: 'A', perform: () => 1, closeOnExecute: false },
    { id: 'b', title: 'B', perform: () => 2, closeOnExecute: false },
    { id: 'c', title: 'C', perform: () => 3, closeOnExecute: false },
  ];
  const nav = createNaviox(commands, opts);
  nav.open();
  await nav.execute('a'); await nav.execute('b'); await nav.execute('c');
  assert.deepEqual(nav.getState().recentIds, ['c', 'b']);
  nav.setFavorite('a', true); nav.setPinned('b', true);
  assert.deepEqual(ids(nav), ['b', 'a', 'c']);
  nav.destroy();
  const again = createNaviox(commands, opts);
  assert.deepEqual(again.getState().recentIds, ['c', 'b']);
  assert.deepEqual(again.getState().favoriteIds, ['a']);
  assert.deepEqual(again.getState().pinnedIds, ['b']);
  again.clearRecents();
  assert.deepEqual(again.getState().recentIds, []);
  again.togglePinned('b'); again.toggleFavorite('a');
  assert.deepEqual(again.getState().pinnedIds, []);
  assert.deepEqual(again.getState().favoriteIds, []);
  again.destroy();
});

test('disabled storage and malformed saved data never crash navigation', () => {
  const storage = { getItem: () => '{bad json', setItem: () => { throw new Error('quota'); } };
  const nav = createNaviox([{ id: 'a', title: 'A' }], { preferences: { storage } });
  nav.setFavorite('a', true); nav.setPinned('a', true);
  assert.deepEqual(nav.getState().favoriteIds, ['a']);
  assert.deepEqual(nav.getState().pinnedIds, ['a']);
  nav.destroy();
});

test('pinned sorting never overrides a stronger relevant query match', () => {
  const nav = createNaviox([
    { id: 'alpha', title: 'Alpha' }, { id: 'z', title: 'Zebra', keywords: ['alpha'] },
  ], { preferences: { prioritizeOnEmptyQuery: true } });
  nav.setPinned('z', true);
  assert.deepEqual(ids(nav), ['z', 'alpha']);
  nav.setQuery('alpha');
  assert.deepEqual(ids(nav), ['alpha', 'z']);
  nav.destroy();
});

test('pure virtual helper yields an overscanned window and zeroes out-of-range sizes', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => i);
  const frame = getNavioxVirtualWindow(rows, { scrollOffset: 1230, viewportSize: 300, estimatedItemSize: 30, overscan: 2 });
  assert.equal(frame.start, 39);
  assert.equal(frame.end, 53);
  assert.deepEqual(frame.items, rows.slice(39, 53));
  assert.equal(frame.paddingStart + frame.items.length * 30 + frame.paddingEnd, frame.totalSize);
  const last = getNavioxVirtualWindow(rows, { scrollOffset: 9999999, viewportSize: 100, estimatedItemSize: 30 });
  assert.equal(last.total, 10000);
  assert.equal(last.end, 10000);
  assert.ok(last.items.length > 0);
  assert.equal(last.items.at(-1), 9999);
  assert.throws(() => getNavioxVirtualWindow(rows, { scrollOffset: 0, viewportSize: 100, estimatedItemSize: 0 }), RangeError);
});

test('10k local items remain searchable with a finite result limit', () => {
  const data = Array.from({ length: 10000 }, (_, n) => ({ id: `task-${n}`, title: `Task ${n}` }));
  const nav = createNaviox(data, { maxResults: 30 });
  nav.setQuery('task 9999');
  assert.equal(nav.getState().results[0].id, 'task-9999');
  assert.ok(nav.getState().results.length <= 30);
  nav.destroy();
});

test('controlled activeId remains parent-owned while async results arrive', async () => {
  const nav = createNaviox([], {
    controlled: { state: { open: true, query: '', activeId: null }, onChange() {} },
    providers: { debounceMs: 0, initial: [{ id: 'p', search: () => ({ items: [{ id: 'a', title: 'A' }] }) }] },
  });
  await sleep();
  assert.equal(nav.getState().activeId, null);
  assert.deepEqual(ids(nav), ['a']);
  nav.destroy();
});

test('different providers settle independently; a rejected source does not block success', async () => {
  const nav = createNaviox([], { defaultOpen: true, providers: { debounceMs: 0, initial: [
    { id: 'bad', search: async () => { throw new Error('Unavailable'); } },
    { id: 'good', search: async () => ({ items: [{ id: 'yes', title: 'Yes' }] }) },
  ] } });
  await sleep();
  assert.equal(nav.getState().providers.bad.status, 'error');
  assert.equal(nav.getState().providers.good.status, 'success');
  assert.deepEqual(ids(nav), ['yes']);
  nav.destroy();
});

test('provider requests honor searchWhenClosed only when explicitly enabled', async () => {
  let calls = 0;
  const nav = createNaviox([], { providers: { searchWhenClosed: true, debounceMs: 0, initial: [
    { id: 'p', search: () => { calls++; return { items: [{ id: 'x', title: 'X' }] }; } },
  ] } });
  await sleep();
  assert.equal(calls, 1);
  assert.deepEqual(ids(nav), ['x']);
  nav.destroy();
});

test('provider registration validates metadata before changing the registry', () => {
  const nav = createNaviox();
  assert.throws(() => nav.registerProvider({ id: '', search: () => ({ items: [] }) }), TypeError);
  assert.throws(() => nav.registerProvider({ id: 'bad', debounceMs: -1, search: () => ({ items: [] }) }), RangeError);
  assert.equal(nav.getProviders().length, 0);
  nav.destroy();
});

test('storage snapshots are immutable, and recents track data-only selection when enabled', () => {
  const nav = createNaviox([{ id: 'first', title: 'First' }], { preferences: {}, defaultOpen: true });
  nav.select('first');
  assert.deepEqual(nav.getState().recentIds, ['first']);
  assert.throws(() => nav.getState().recentIds.push('oops'), TypeError);
  nav.destroy();
});

test('cache expiration and bounded LRU force network-like source refresh', async () => {
  let calls = 0;
  const nav = createNaviox([], { defaultOpen: true, providers: {
    debounceMs: 0, cache: { maxEntries: 1, ttlMs: 15 }, initial: [{ id: 'p', search: ({ query }) => {
      calls++; return { items: [{ id: query || 'root', title: 'Result' }] };
    } }],
  } });
  await sleep();
  nav.setQuery('a'); await sleep();
  nav.setQuery(''); await sleep();
  assert.equal(calls, 3); // The 'root' entry was evicted.
  await sleep(18);
  nav.setQuery('a'); await sleep();
  assert.equal(calls, 4); // The remaining entry expired.
  nav.destroy();
});
