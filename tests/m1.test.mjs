import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNaviox, createNavioxRegistry, createNavioxSearch,
  rankItems, normalizeSearchText,
} from '@blcklab/naviox'; // Self-referencing package export: tests actual ESM consumer path.

const source = [
  { id: 'home', title: 'Home', href: '/' },
  { id: 'account', title: 'Account Settings', aliases: ['preferences'], group: 'Pages' },
  { id: 'readonly', title: 'View-only info', readOnly: true },
  { id: 'disabled', title: 'Disabled option', disabled: true },
  { id: 'hidden', title: 'Secret', hidden: true },
  { id: 'editor', title: 'Edit page', pageId: 'tools' },
];

const ids = (items) => items.map((item) => item.id);

test('registry clones and freezes nested metadata without modifying caller objects', () => {
  const original = {
    id: 'a', title: 'Alpha', keywords: ['a'],
    preview: { meta: [{ label: 'Type', value: 'Page' }] },
  };
  const registry = createNavioxRegistry([original]);
  original.title = 'Modified'; original.keywords.push('b'); original.preview.meta[0].value = 'Unknown';
  assert.equal(registry.get('a').title, 'Alpha');
  assert.deepEqual(registry.get('a').keywords, ['a']);
  assert.equal(registry.get('a').preview.meta[0].value, 'Page');
  assert.ok(Object.isFrozen(registry.get('a')));
  assert.ok(Object.isFrozen(registry.getItems()));
  assert.throws(() => { registry.get('a').title = 'Boom'; }, TypeError);
  registry.destroy();
});

test('registry rejects invalid and duplicate IDs and registration is transactional', () => {
  assert.throws(() => createNavioxRegistry([{ id: '', title: 'Empty' }]), /nonempty/);
  assert.throws(() => createNavioxRegistry([{ id: 'a', title: 'A' }, { id: 'a', title: 'A2' }]), /Duplicate/);
  const registry = createNavioxRegistry([{ id: 'x', title: 'X' }]);
  assert.throws(() => registry.registerMany([{ id: 'new', title: 'New' }, { id: 'x', title: 'Duplicate' }]), /Duplicate/);
  assert.equal(registry.get('new'), undefined);
  assert.throws(() => registry.registerMany([{ id: 'duplicate', title: 'One' }, { id: 'duplicate', title: 'Two' }]), /Duplicate/);
  assert.equal(registry.getItems().length, 1);
  registry.destroy();
});

test('registry add/update/remove preserves insertion order and prevents stale disposer removal', () => {
  const registry = createNavioxRegistry([{ id: 'a', title: 'A' }]);
  const events = [];
  const unsub = registry.subscribe(() => events.push(ids(registry.getItems())));
  const dispose = registry.register({ id: 'b', title: 'B' });
  assert.ok(registry.update('b', { title: 'Bee', id: 'unexpected' }));
  assert.equal(registry.get('b').title, 'Bee');
  assert.equal(registry.get('b').id, 'b');
  dispose(); // Old registration no longer owns an updated item.
  assert.equal(registry.get('b').title, 'Bee');
  assert.deepEqual(ids(registry.getItems()), ['a', 'b']);
  assert.equal(registry.update('unknown', { title: 'Nope' }), false);
  assert.equal(registry.unregister('unknown'), false);
  assert.equal(registry.unregister('a'), true);
  assert.deepEqual(ids(registry.getItems()), ['b']);
  assert.equal(events.length, 3);
  unsub();
  registry.destroy();
  registry.register({ id: 'c', title: 'C' });
  assert.deepEqual(registry.getItems(), []);
});

test('registry bulk disposal removes only its own untouched entries', () => {
  const registry = createNavioxRegistry();
  const dispose = registry.registerMany([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  registry.update('a', { title: 'Updated' });
  dispose(); dispose();
  assert.deepEqual(ids(registry.getItems()), ['a']);
});

test('search normalizes accents, uses aliases and strict AND tokens', () => {
  assert.equal(normalizeSearchText('  Café  '), 'cafe');
  assert.deepEqual(ids(rankItems(source, 'preferences').map((value) => value.item)), ['account']);
  assert.deepEqual(ids(rankItems(source, 'account preferences').map((value) => value.item)), ['account']);
  assert.equal(rankItems(source, 'account completely-unfindable').length, 0);
  assert.equal(rankItems(source, 'secret').length, 0);
  assert.equal(rankItems(source, '', 0).length, 0);
  assert.equal(rankItems(source, '', Number.NaN).length, 5);
});

test('search priorities break ties without overriding stronger title match', () => {
  const list = [
    { id: 'first', title: 'Build' },
    { id: 'second', title: 'Build', priority: 2 },
    { id: 'weak', title: 'Other', keywords: ['build'], priority: 100 },
  ];
  assert.deepEqual(ids(rankItems(list, 'build').map((value) => value.item)), ['second', 'first', 'weak']);
  assert.deepEqual(ids(rankItems(list, '').map((value) => value.item)), ['weak', 'second', 'first']);
});

test('custom search can score, filter and compare without mutation', () => {
  const search = createNavioxSearch({
    score: (item, _, tokens) => item.title.toLowerCase() === tokens[0] ? 10 : 0,
    filter: (_, context) => context.allowed === true,
    context: { allowed: true },
    compare: (a, b) => b.index - a.index,
  });
  assert.deepEqual(ids(search.search([{ id: 'a', title: 'Y' }, { id: 'b', title: 'Y' }], 'y')), ['b', 'a']);
  assert.equal(search.search(source, 'work').length, 0);
  const denied = createNavioxSearch({ filter: (_, context) => context.allowed === true });
  assert.equal(denied.search(source, '').length, 0);
  assert.deepEqual(ids(rankItems([{ id: 'x', title: 'X' }], 'x', 3, { score: () => Infinity }).map((v) => v.item)), []);
});

test('uncontrolled default state and missing results stay internally consistent', () => {
  const controller = createNaviox(source, { defaultOpen: true, defaultQuery: 'disabled' });
  assert.equal(controller.getState().open, true);
  assert.equal(controller.getState().activeId, null);
  assert.deepEqual(ids(controller.getState().results), ['disabled']);
  controller.setQuery('home');
  assert.equal(controller.getState().activeId, 'home');
  controller.close();
  assert.equal(controller.getState().query, '');
  assert.equal(controller.getState().activeId, null);
  controller.destroy();
});

test('controller dynamic mutations rebuild results and preserve active item when valid', () => {
  const c = createNaviox(source);
  c.open();
  c.setActive('account');
  const events = [];
  c.subscribe((state) => events.push(state));
  const dispose = c.register({ id: 'tmp', title: 'Temporary' });
  assert.equal(c.getState().activeId, 'account');
  assert.ok(c.updateItem('tmp', { title: 'Updated temporary' }));
  c.setQuery('updated');
  assert.equal(c.getState().activeId, 'tmp');
  dispose(); // no effect after update
  assert.equal(c.getState().activeId, 'tmp');
  assert.equal(c.unregister('tmp'), true);
  assert.equal(c.getState().activeId, null);
  assert.ok(events.length >= 3);
  c.destroy();
});

test('keyboard navigation skips disabled, respects readOnly and no-loop policy', () => {
  const c = createNaviox(source, { loop: false, pageSize: 2 });
  c.open();
  assert.equal(c.getState().activeId, 'home');
  c.handleKey('ArrowUp');
  assert.equal(c.getState().activeId, 'home');
  c.handleKey('PageDown');
  assert.equal(c.getState().activeId, 'readonly');
  assert.equal(c.handleKey('Enter').selected, null);
  c.handleKey('End');
  assert.equal(c.getState().activeId, 'readonly');
  c.handleKey('PageUp');
  assert.equal(c.getState().activeId, 'home');
  assert.equal(c.handleKey('Unexpected').handled, false);
  assert.equal(c.handleKey('Enter').selected.id, 'home');
  assert.equal(c.getState().lastSelectedId, 'home');
  assert.equal(c.getState().open, false);
  c.destroy();
});

test('looping, Home, End and invalid movement do not select disabled items', () => {
  const c = createNaviox(source);
  c.open();
  c.handleKey('End');
  assert.equal(c.getState().activeId, 'readonly');
  c.handleKey('ArrowDown');
  assert.equal(c.getState().activeId, 'home');
  c.handleKey('Home');
  assert.equal(c.getState().activeId, 'home');
  c.handleKey('ArrowUp');
  assert.equal(c.getState().activeId, 'readonly');
  c.move(Infinity);
  c.jump(Number.NaN);
  c.move(0);
  assert.equal(c.getState().activeId, 'readonly');
  c.handleKey('Escape');
  assert.equal(c.getState().open, false);
  c.destroy();
});

test('pages, groups and context scope results without polluting original source', () => {
  const c = createNaviox(source, { groups: [{ id: 'Pages', title: 'Pages' }] });
  c.open();
  assert.equal(c.getState().results.some((item) => item.id === 'editor'), false);
  c.setQuery('home');
  c.setPage('tools');
  assert.deepEqual(ids(c.getState().results), ['editor']);
  assert.equal(c.getState().query, '');
  assert.equal(c.getState().pageId, 'tools');
  c.setPage(null);
  assert.equal(c.getState().results.some((item) => item.id === 'editor'), false);
  c.setGroups([{ id: 'Pages', title: 'Pages', disabled: true }]);
  assert.equal(c.getState().results.some((item) => item.id === 'account'), false);
  assert.throws(() => c.setGroups([{ id: 'x', title: 'A' }, { id: 'x', title: 'B' }]), /duplicate/);
  assert.equal(c.getGroups()[0].disabled, true);
  c.setContext({ role: 'admin' });
  assert.equal(c.getState().context.role, 'admin');
  assert.ok(Object.isFrozen(c.getState().context));
  c.destroy();
});

test('context feeds custom search filter; empty query is filtered too', () => {
  const c = createNaviox(source, { search: { filter: (item, context) => context.admin || item.id === 'home' } });
  assert.deepEqual(ids(c.getState().results), ['home']);
  c.setContext({ admin: true });
  assert.ok(c.getState().results.length > 1);
  c.setContext({ admin: false });
  assert.deepEqual(ids(c.getState().results), ['home']);
  c.destroy();
});

test('controlled state requests do not commit until the parent synchronizes', () => {
  const requests = [];
  const c = createNaviox(source, { controlled: {
    state: { open: false, query: '', activeId: null },
    onChange: (next, reason) => requests.push({ next, reason }),
  } });
  let events = 0;
  c.subscribe(() => events++);
  c.open();
  assert.equal(c.getState().open, false);
  assert.equal(requests[0].reason, 'open');
  assert.equal(requests[0].next.activeId, 'home');
  assert.equal(events, 0);
  c.syncControlledState(requests[0].next);
  assert.equal(c.getState().open, true);
  assert.equal(events, 1);
  c.setQuery('account');
  assert.equal(c.getState().query, '');
  assert.equal(requests[1].reason, 'query');
  c.syncControlledState(requests[1].next);
  assert.equal(c.getState().query, 'account');
  assert.deepEqual(ids(c.getState().results), ['account']);
  c.select();
  assert.equal(requests.at(-1).reason, 'select');
  assert.equal(c.getState().lastSelectedId, 'account');
  assert.equal(c.getState().open, true);
  c.syncControlledState(requests.at(-1).next);
  assert.equal(c.getState().open, false);
  c.destroy();
});

test('uncontrolled instances reject sync and remain independent', () => {
  const a = createNaviox(source); const b = createNaviox(source);
  assert.throws(() => a.syncControlledState({ open: true, query: '', activeId: 'home' }), /requires/);
  a.open(); a.setQuery('account');
  assert.equal(b.getState().open, false);
  assert.equal(b.getState().query, '');
  a.destroy(); b.destroy();
});

test('subscriptions are removable and nested notifications are delivered in order', () => {
  const c = createNaviox(source);
  const calls = [];
  const unsubscribe = c.subscribe((s) => {
    calls.push(`a:${s.open}:${s.query}`);
    if (s.open && !s.query) c.setQuery('account');
  });
  c.subscribe((s) => calls.push(`b:${s.open}:${s.query}`));
  c.open();
  assert.deepEqual(calls.slice(0, 4), ['a:true:', 'b:true:', 'a:true:account', 'b:true:account']);
  unsubscribe();
  c.close();
  assert.equal(calls.at(-1), 'b:false:');
  c.destroy();
  c.open();
  assert.equal(c.getState().open, false);
  assert.equal(c.subscribe(() => {}) instanceof Function, true);
});

test('search groups cannot be changed after destruction', () => {
  const c = createNaviox(source);
  c.destroy();
  c.setGroups([{ id: 'new', title: 'New' }]);
  c.setItems([]);
  c.setContext({ x: 1 });
  c.setPage('tools');
  assert.deepEqual(c.getGroups(), []);
});

test('controlled page changes request a new selection and preserve committed controls until sync', () => {
  const requests = [];
  const c = createNaviox(source, {
    controlled: {
      state: { open: true, query: 'home', activeId: 'home' },
      onChange: (next, reason) => requests.push([next, reason]),
    },
  });
  c.setPage('tools');
  assert.equal(c.getState().pageId, 'tools');
  assert.equal(c.getState().query, 'home'); // externally owned
  assert.equal(c.getState().activeId, null); // invalidated in the new scope
  assert.equal(requests[0][1], 'page');
  assert.deepEqual(requests[0][0], { open: true, query: '', activeId: 'editor' });
  c.syncControlledState(requests[0][0]);
  assert.equal(c.getState().activeId, 'editor');
  c.close();
  assert.equal(requests.at(-1)[1], 'close');
  c.destroy();
});

test('toggles both ways and bulk item registration integrates with controller', () => {
  const c = createNaviox();
  c.toggle();
  assert.equal(c.getState().open, true);
  assert.equal(c.getState().activeId, null);
  const dispose = c.registerMany([{ id: 'red', title: 'Red' }, { id: 'blue', title: 'Blue' }]);
  assert.equal(c.getState().activeId, 'red');
  c.setActive('blue');
  assert.equal(c.getState().activeId, 'blue');
  dispose();
  assert.equal(c.getState().activeId, null);
  c.toggle();
  assert.equal(c.getState().open, false);
  c.destroy();
});

test('empty and nonselectable results are keyboard-safe, and invalid selections are ignored', () => {
  const c = createNaviox([{ id: 'off', title: 'Off', disabled: true }]);
  c.open();
  c.handleKey('ArrowDown');
  c.handleKey('ArrowUp');
  c.handleKey('PageDown');
  c.handleKey('Home');
  c.handleKey('End');
  c.move(-2);
  c.jump(-5);
  c.setActive('off');
  assert.equal(c.getState().activeId, null);
  assert.equal(c.select('off'), null);
  assert.equal(c.handleKey('Enter').selected, null);
  c.setQuery('never matches');
  assert.equal(c.getState().results.length, 0);
  assert.equal(c.getState().activeId, null);
  c.close();
  assert.equal(c.handleKey('Enter').handled, false);
  c.destroy();
});

test('jump clamps at boundaries and handles missing active selection', () => {
  const c = createNaviox(source, { pageSize: 20 });
  c.open();
  c.jump(100);
  assert.equal(c.getState().activeId, 'readonly');
  c.jump(-100);
  assert.equal(c.getState().activeId, 'home');
  c.jump(0);
  c.jump(Infinity);
  assert.equal(c.getState().activeId, 'home');
  c.destroy();
});

test('forced groups updates and unchanged query cause only meaningful notifications', () => {
  const c = createNaviox(source);
  let notifications = 0;
  c.subscribe(() => { notifications++; });
  c.setQuery('');
  c.close();
  c.setPage(null);
  assert.equal(notifications, 0);
  c.setGroups([{ id: 'extra', title: 'Extra' }]);
  assert.equal(notifications, 1);
  c.setItems([{ id: 'new', title: 'New' }]);
  assert.equal(notifications, 2);
  assert.deepEqual(ids(c.getItems()), ['new']);
  c.destroy();
});

test('destroyed instance is inert for all commands', () => {
  const c = createNaviox(source);
  const snapshot = c.getState();
  c.destroy(); c.destroy();
  c.open(); c.close(); c.toggle(); c.move(1); c.jump(1);
  c.setActive('home'); c.setQuery('home'); c.setItems([]);
  c.setContext({ field: true }); c.setPage('tools');
  assert.equal(c.unregister('home'), false);
  assert.equal(c.updateItem('home', { title: 'New' }), false);
  assert.equal(c.select('home'), null);
  assert.equal(c.getState(), snapshot);
});

test('explicit null in externally controlled activeId overrides uncontrolled defaults', () => {
  const c = createNaviox(source, {
    defaultOpen: true,
    defaultActiveId: 'home',
    controlled: {
      state: { open: true, query: '', activeId: null },
      onChange() {},
    },
  });
  assert.equal(c.getState().open, true);
  assert.equal(c.getState().activeId, null);
  c.destroy();
});
