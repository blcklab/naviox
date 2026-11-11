import test from 'node:test';
import assert from 'node:assert/strict';
import { createNaviox, createNavioxHttpProvider } from '../dist/index.js';

const entry = (id, perform = () => id) => ({ id, title: id, perform, closeOnExecute: false });
const make = (items = [], options = {}) => createNaviox(items, { providers: { debounceMs: 0 }, ...options });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('extension registers standalone items and cleans up on disposal', () => {
  const controller = make([{ id: 'local', title: 'Local' }]);
  const off = controller.use({ id: 'docs', setup(api) {
    api.registerItem({ id: 'docs:search', title: 'Search Docs' });
    api.registerItems([{ id: 'docs:open', title: 'Open Docs' }, { id: 'docs:help', title: 'Help' }]);
  } });
  assert.deepEqual(controller.listExtensions(), ['docs']);
  assert.equal(controller.getItems().length, 4);
  off(); off();
  assert.deepEqual(controller.getItems().map((item) => item.id), ['local']);
  assert.deepEqual(controller.listExtensions(), []);
  controller.destroy();
});

test('duplicate extension ids are rejected; failed setup rolls back owned registrations', () => {
  const controller = make();
  const off = controller.use({ id: 'one', setup(api) { api.registerItem({ id: 'one:item', title: 'A' }); } });
  assert.throws(() => controller.use({ id: 'one', setup() {} }), /Duplicate Naviox extension/);
  assert.throws(() => controller.use({ id: 'invalid', setup(api) {
    api.registerItem({ id: 'temporary', title: 'Temporary' });
    api.registerItem({ id: 'one:item', title: 'Collision' });
  } }), /Duplicate Naviox item/);
  assert.deepEqual(controller.getItems().map((i) => i.id), ['one:item']);
  assert.deepEqual(controller.listExtensions(), ['one']);
  off(); controller.destroy();
});

test('initial extension setup is atomic with respect to controller lifetime', () => {
  let cleaned = 0;
  assert.throws(() => make([], { extensions: [
    { id: 'one', setup(api) { api.onCleanup(() => cleaned++); api.registerItem({ id: 'x', title: 'X' }); } },
    { id: 'two', setup() { throw new Error('bad'); } },
  ] }), /bad/);
  assert.equal(cleaned, 1);
});

test('extensions own provider registrations; unloading aborts and removes results', async () => {
  const controller = make([], { providers: { debounceMs: 0 } });
  let requests = 0;
  const off = controller.use({ id: 'remote', setup(api) {
    api.registerProvider({ id: 'search', async search(req) {
      requests++;
      return { items: [{ id: 'remote:a', title: 'Remote A' }] };
    } });
  } });
  controller.open();
  await controller.refreshProviders();
  assert.ok(requests >= 1);
  assert.ok(controller.getState().results.some((item) => item.id === 'remote:a'));
  off();
  assert.equal(controller.getProviders().length, 0);
  assert.equal(controller.getState().results.length, 0);
  controller.destroy();
});

test('hooks run in extension insertion order, before and after action', async () => {
  const events = [];
  const controller = make([entry('go', () => { events.push('action'); return 42; })]);
  for (const id of ['a', 'b']) controller.use({ id, setup(api) {
    api.beforeExecute(async () => { events.push(`before:${id}`); });
    api.afterExecute(async (result) => { events.push(`after:${id}:${result.status}`); });
  } });
  const result = await controller.execute('go');
  assert.equal(result.status, 'success');
  assert.equal(result.value, 42);
  assert.deepEqual(events, ['before:a', 'before:b', 'action', 'after:a:success', 'after:b:success']);
  controller.destroy();
});

test('beforeExecute can veto without invoking command and afterExecute sees cancellation', async () => {
  let actions = 0;
  const observations = [];
  const controller = make([entry('safe', () => { actions++; })]);
  controller.use({ id: 'gate', setup(api) {
    api.beforeExecute(() => false);
    api.afterExecute((result) => observations.push(result.status));
  } });
  const result = await controller.execute('safe');
  assert.equal(result.status, 'cancelled');
  assert.equal(actions, 0);
  assert.equal(controller.getState().execution.status, 'cancelled');
  assert.deepEqual(observations, ['cancelled']);
  controller.destroy();
});

test('pre-execution hook failures become action errors; post hooks still observe them', async () => {
  const controller = make([entry('go')]);
  const seen = [];
  controller.use({ id: 'gate', setup(api) {
    api.beforeExecute(() => { throw new Error('denied'); });
    api.afterExecute((result) => seen.push(result.status));
  } });
  const result = await controller.execute('go');
  assert.equal(result.status, 'error');
  assert.match(result.error.message, /denied/);
  assert.deepEqual(seen, ['error']);
  controller.destroy();
});

test('post-execution hook errors are reported without changing successful result', async () => {
  const reports = [];
  const controller = make([entry('go')], { onExtensionError: (event) => reports.push(event) });
  controller.use({ id: 'metrics', setup(api) { api.afterExecute(() => { throw new Error('offline'); }); } });
  const result = await controller.execute('go');
  assert.equal(result.status, 'success');
  assert.equal(reports[0].extensionId, 'metrics');
  assert.equal(reports[0].phase, 'after-execute');
  controller.destroy();
});

test('state subscriptions are scoped, nested changes are delivered, and faults isolated', () => {
  const reports = [];
  const observed = [];
  const controller = make([entry('go')], { onExtensionError: (event) => reports.push(event) });
  const off = controller.use({ id: 'observer', setup(api) {
    api.onStateChange((state) => {
      observed.push(state.query);
      if (state.query === 'a') api.setQuery('b');
      if (state.query === 'b') throw new Error('nonfatal');
    });
  } });
  controller.open(); controller.setQuery('a');
  assert.ok(observed.includes('a'));
  assert.ok(observed.includes('b'));
  assert.equal(reports[0]?.phase, 'state');
  off();
  const size = observed.length;
  controller.setQuery('c');
  assert.equal(observed.length, size);
  controller.destroy();
});

test('manual disposer is idempotent, and onCleanup runs once on destroy', () => {
  const calls = [];
  const controller = make();
  controller.use({ id: 'plugin', setup(api) {
    const off = api.onCleanup(() => calls.push('a'));
    api.onCleanup(() => calls.push('b'));
    off(); off();
    return () => calls.push('c');
  } });
  controller.destroy(); controller.destroy();
  assert.deepEqual(calls, ['a', 'c', 'b']);
  assert.throws(() => controller.use({ id: 'late', setup() {} }), /after destroy/);
});

test('cleanup throwing is reported; all resources are still released', () => {
  const reports = [];
  const controller = make([], { onExtensionError: (event) => reports.push(event) });
  controller.use({ id: 'broken', setup(api) {
    api.registerItem({ id: 'a', title: 'A' });
    api.onCleanup(() => { throw new Error('cleanup'); });
  } });
  controller.destroy();
  assert.equal(reports[0].phase, 'dispose');
});

test('unloading during a pre-execute async hook skips later hooks', async () => {
  let resolve;
  const block = new Promise((r) => { resolve = r; });
  const events = [];
  const controller = make([entry('go', () => events.push('action'))]);
  const off = controller.use({ id: 'first', setup(api) { api.beforeExecute(async () => { events.push('wait'); await block; }); } });
  controller.use({ id: 'second', setup(api) { api.beforeExecute(() => { events.push('second'); }); } });
  const promise = controller.execute('go');
  off();
  resolve();
  const result = await promise;
  assert.equal(result.status, 'success');
  assert.deepEqual(events, ['wait', 'second', 'action']);
  controller.destroy();
});

test('when a newer execution starts, the old pre-hook cannot execute an outdated action', async () => {
  let resolve;
  const blocker = new Promise((r) => { resolve = r; });
  const ran = [];
  const controller = make([entry('first', () => ran.push('first')), entry('second', () => ran.push('second'))]);
  controller.use({ id: 'blocking', setup(api) { api.beforeExecute(async (ctx) => {
    if (ctx.item.id === 'first') await blocker;
  }); } });
  const a = controller.execute('first');
  const b = controller.execute('second');
  resolve();
  assert.equal((await a).status, 'cancelled');
  assert.equal((await b).status, 'success');
  assert.deepEqual(ran, ['second']);
  controller.destroy();
});

test('asynchronous post-hook for an old task must not close a newer task', async () => {
  let resolve;
  const blocker = new Promise((r) => { resolve = r; });
  const controller = make([entry('first'), entry('second')]);
  controller.use({ id: 'after', setup(api) {
    api.afterExecute(async (result) => { if (result.item.id === 'first') await blocker; });
  } });
  controller.open();
  const a = controller.execute('first');
  await tick();
  const b = controller.execute('second');
  await b;
  controller.open();
  resolve();
  await a;
  assert.equal(controller.getState().open, true);
  controller.destroy();
});

test('extensions remain controller-scoped and do not leak between instances', () => {
  const a = make(), b = make();
  a.use({ id: 'plugin', setup(api) { api.registerItem({ id: 'a', title: 'A' }); } });
  b.use({ id: 'plugin', setup(api) { api.registerItem({ id: 'b', title: 'B' }); } });
  assert.equal(a.getItems()[0].id, 'a');
  assert.equal(b.getItems()[0].id, 'b');
  a.destroy(); b.destroy();
});

test('plugin input validation rejects invalid id and invalid setup return', () => {
  const c = make();
  assert.throws(() => c.use({ id: ' ', setup() {} }), /id and setup/);
  assert.throws(() => c.use({ id: 'bad', setup: null }), /id and setup/);
  assert.throws(() => c.use({ id: 'bad', setup() { return 12; } }), /cleanup function/);
  assert.deepEqual(c.listExtensions(), []);
  c.destroy();
});

test('HTTP provider maps search, cursor, headers and preserves injected request signal', async () => {
  const seen = [];
  const provider = createNavioxHttpProvider({
    id: 'docs', url: 'https://example.test/api/find?key=x',
    client: async (url, init) => {
      seen.push([url, init]);
      return { ok: true, status: 200, json: async () => ({ hits: [{ id: 'doc:a', title: 'Doc A' }], next: 'cursor+2' }) };
    },
    headers: (req) => ({ Authorization: `Bearer ${req.context.token}` }),
    mapResponse: (payload) => ({ items: payload.hits, nextCursor: payload.next }),
  });
  const signal = new AbortController().signal;
  const out = await provider.search({ query: 'A&B', cursor: null, pageId: null, limit: 10, context: { token: 'abc' }, signal });
  assert.equal(out.items[0].id, 'doc:a');
  assert.equal(out.nextCursor, 'cursor+2');
  assert.ok(seen[0][0].includes('q=A%26B'));
  assert.ok(seen[0][0].includes('key=x'));
  assert.equal(seen[0][1].signal, signal);
  assert.equal(seen[0][1].headers.Authorization, 'Bearer abc');
});

test('HTTP provider permits root-relative paths and custom request parameters', async () => {
  const requested = [];
  const p = createNavioxHttpProvider({ id: 'local', url: '/search?existing=1',
    client: async (url) => { requested.push(url); return { ok: true, status: 200, json: async () => ({ docs: [] }) }; },
    params: (req) => ({ cursor: req.cursor, q: req.query, offset: 0, preview: false }),
    mapResponse: (body) => ({ items: body.docs }),
  });
  await p.search({ query: 'abcd', cursor: 'last', pageId: 'docs', limit: 10, context: {}, signal: new AbortController().signal });
  assert.equal(requested[0], '/search?existing=1&cursor=last&q=abcd&offset=0&preview=false');
});

test('HTTP transport errors propagate to the existing provider status machinery', async () => {
  const provider = createNavioxHttpProvider({ id: 'failed', url: '/api', debounceMs: 0,
    client: async () => ({ ok: false, status: 503, json: async () => null }),
    mapResponse: () => ({ items: [] }),
  });
  const controller = make([], { providers: { debounceMs: 0, initial: [provider] } });
  controller.open();
  await controller.refreshProviders();
  assert.equal(controller.getState().providers.failed.status, 'error');
  assert.match(controller.getState().providers.failed.error.message, /503/);
  controller.destroy();
});

test('HTTP provider rejects malformed addresses and explicit cancellation', async () => {
  const opts = { id: 'p', client: async () => ({ ok: true, status: 200, json: async () => ({}) }), mapResponse: () => ({ items: [] }) };
  assert.throws(() => createNavioxHttpProvider({ ...opts, url: 'javascript:alert(1)' }), /root-relative/);
  assert.throws(() => createNavioxHttpProvider({ ...opts, url: '//host/path' }), /Protocol-relative/);
  assert.throws(() => createNavioxHttpProvider({ ...opts, url: 'https://u:pw@host/x' }), /credentials/);
  const provider = createNavioxHttpProvider({ ...opts, url: '/api' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(provider.search({ query: '', pageId: null, cursor: null, limit: 10, context: {}, signal: abort.signal }), /aborted/);
});


test('removed extension cannot veto a command after its asynchronous hook settles', async () => {
  let resolve;
  const blocker = new Promise((r) => { resolve = r; });
  let executed = false;
  const controller = make([entry('go', () => { executed = true; })]);
  const off = controller.use({ id: 'gate', setup(api) {
    api.beforeExecute(async () => { await blocker; return false; });
  } });
  const task = controller.execute('go');
  off(); resolve();
  assert.equal((await task).status, 'success');
  assert.equal(executed, true);
  controller.destroy();
});

test('removed extension errors from an in-flight check cannot break execution', async () => {
  let reject;
  const blocker = new Promise((_, rej) => { reject = rej; });
  const controller = make([entry('go')]);
  const off = controller.use({ id: 'gate', setup(api) { api.beforeExecute(() => blocker); } });
  const task = controller.execute('go');
  off(); reject(new Error('late error'));
  assert.equal((await task).status, 'success');
  controller.destroy();
});
