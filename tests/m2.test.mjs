import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNaviox, matchesNavioxShortcut, parseNavioxShortcut, sectionItems,
} from '@blcklab/naviox';

const ids = (items) => items.map((item) => item.id);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const pages = [
  { id: 'settings', title: 'Settings' },
  { id: 'theme', title: 'Theme', parentId: 'settings' },
  { id: 'color', title: 'Colors', parentId: 'theme' },
  { id: 'dark', title: 'Dark', parentId: 'color', perform: () => 'dark' },
  { id: 'profile', title: 'Profile', parentId: 'settings' },
  { id: 'about', title: 'About' },
];

test('nested activation, breadcrumb titles and Backspace/Escape navigate instead of closing', () => {
  const nav = createNaviox(pages);
  nav.open();
  assert.deepEqual(ids(nav.getState().results), ['settings', 'about']);
  assert.equal(nav.activate('settings').kind, 'page');
  assert.deepEqual(ids(nav.getState().results), ['theme', 'profile']);
  assert.equal(nav.getState().activeId, 'theme');
  assert.equal(nav.handleKey('Enter').selected, null);
  nav.activate('color');
  assert.deepEqual(nav.getState().pageStack, ['settings', 'theme', 'color']);
  assert.deepEqual(nav.getState().breadcrumbs.map((v) => v.title), ['Settings', 'Theme', 'Colors']);
  nav.setQuery('dark');
  assert.equal(nav.handleKey('Backspace').handled, false);
  nav.setQuery('');
  assert.equal(nav.handleKey('Backspace').handled, true);
  assert.equal(nav.getState().pageId, 'theme');
  nav.handleKey('Escape');
  assert.equal(nav.getState().pageId, 'settings');
  nav.handleKey('Escape');
  assert.equal(nav.getState().pageId, null);
  assert.equal(nav.getState().open, true);
  nav.handleKey('Escape');
  assert.equal(nav.getState().open, false);
});

test('pushPage requires children, blocks cycles and preserves legacy pageId scopes', () => {
  const nav = createNaviox([...pages, { id: 'legacy', title: 'Legacy child', pageId: 'tools' }]);
  assert.equal(nav.pushPage('does-not-exist'), false);
  assert.equal(nav.pushPage('tools'), true);
  assert.deepEqual(ids(nav.getState().results), ['legacy']);
  assert.equal(nav.pushPage('tools'), false);
  assert.equal(nav.back(), true);
  nav.setPage('tools');
  assert.deepEqual(nav.getState().pageStack, ['tools']);
  nav.setPage(null);
  assert.equal(nav.back(), false);
  nav.destroy();
});

test('dynamic parent title changes are reflected in breadcrumbs', () => {
  const nav = createNaviox(pages);
  nav.pushPage('settings');
  nav.updateItem('settings', { title: 'Preferences' });
  assert.deepEqual(nav.getState().breadcrumbs, [{ id: 'settings', title: 'Preferences' }]);
  nav.unregister('settings');
  assert.equal(nav.getState().breadcrumbs[0].title, 'settings');
  nav.back();
  nav.destroy();
});

test('activation keeps M1 select data-only while Enter starts M2 actions', async () => {
  let calls = 0;
  const nav = createNaviox([{ id: 'a', title: 'A', perform: () => ++calls }]);
  nav.open();
  assert.equal(nav.select().id, 'a');
  assert.equal(calls, 0);
  nav.open();
  const activated = nav.handleKey('Enter');
  assert.equal(activated.selected.id, 'a');
  assert.equal(nav.getState().execution.status, 'running');
  assert.equal((await activated.execution).status, 'success');
  assert.equal(calls, 1);
  assert.equal(nav.getState().open, false);
});

test('async execution publishes progress and stays open when configured', async () => {
  const task = deferred();
  let actionContext;
  const nav = createNaviox([{
    id: 'task', title: 'Task', closeOnExecute: false,
    perform: (context) => { actionContext = context; return task.promise; },
  }], { defaultOpen: true });
  const statuses = [];
  nav.subscribe((s) => statuses.push(s.execution.status));
  const work = nav.execute('task');
  assert.equal(nav.getState().execution.status, 'running');
  assert.equal(actionContext.signal.aborted, false);
  actionContext.reportProgress({ message: 'Halfway', current: 1, total: 2 });
  assert.deepEqual(nav.getState().execution.progress, { message: 'Halfway', current: 1, total: 2 });
  task.resolve(42);
  assert.deepEqual(await work, { status: 'success', item: nav.getItems()[0], value: 42 });
  assert.equal(nav.getState().execution.status, 'success');
  assert.equal(nav.getState().open, true);
  assert.deepEqual(statuses, ['running', 'running', 'success']);
});

test('sync throw and async rejection are surfaced without unhandled rejections', async () => {
  const error = new Error('cannot deploy');
  const nav = createNaviox([
    { id: 'throws', title: 'Throws', perform() { throw error; } },
    { id: 'rejects', title: 'Rejects', perform: async () => { throw error; } },
  ], { defaultOpen: true });
  const a = await nav.execute('throws');
  assert.equal(a.status, 'error');
  assert.equal(a.error, error);
  const b = await nav.execute('rejects');
  assert.equal(b.status, 'error');
  assert.equal(nav.getState().execution.error, error);
  assert.equal(nav.getState().open, true);
});

test('explicit cancellation aborts work and ignores late progress/results', async () => {
  const task = deferred();
  let context;
  const nav = createNaviox([{ id: 'wait', title: 'Wait', perform: (ctx) => { context = ctx; return task.promise; } }]);
  const promise = nav.execute('wait');
  nav.cancelExecution();
  assert.equal(context.signal.aborted, true);
  assert.equal(nav.getState().execution.status, 'cancelled');
  context.reportProgress({ message: 'too late' });
  task.resolve('stale');
  assert.equal((await promise).status, 'cancelled');
  assert.equal(nav.getState().execution.progress, undefined);
});

test('new execution invalidates previous command; old rejects do not overwrite new state', async () => {
  const first = deferred();
  const second = deferred();
  const nav = createNaviox([
    { id: 'one', title: 'One', perform: () => first.promise, closeOnExecute: false },
    { id: 'two', title: 'Two', perform: () => second.promise, closeOnExecute: false },
  ], { defaultOpen: true });
  const one = nav.execute('one');
  const two = nav.execute('two');
  first.reject(new Error('stale rejection'));
  second.resolve('new');
  assert.equal((await one).status, 'cancelled');
  assert.equal((await two).status, 'success');
  assert.equal(nav.getState().execution.itemId, 'two');
});

test('close and destroy abort pending work and never publish stale completion', async () => {
  const pending = deferred();
  let context;
  const nav = createNaviox([{
    id: 'wait', title: 'Wait', perform: (ctx) => { context = ctx; return pending.promise; },
  }], { defaultOpen: true });
  const running = nav.execute('wait');
  nav.close();
  assert.equal(context.signal.aborted, true);
  assert.equal(nav.getState().execution.status, 'cancelled');
  nav.destroy();
  pending.resolve('late');
  assert.equal((await running).status, 'cancelled');
  assert.equal(nav.getState().open, false);
});

test('action-provided close does not abort its own successful task', async () => {
  const nav = createNaviox([{
    id: 'close', title: 'Close', perform: ({ close }) => { close(); return 'done'; },
  }], { defaultOpen: true });
  const result = await nav.execute('close');
  assert.equal(result.status, 'success');
  assert.equal(nav.getState().open, false);
  assert.equal(nav.getState().execution.status, 'success');
});

test('routes are inert unless navigate handler is explicitly provided', async () => {
  const called = [];
  const item = { id: 'home', title: 'Home', href: '/' };
  const plain = createNaviox([item]);
  assert.equal((await plain.execute('home')).status, 'ignored');
  plain.open();
  assert.equal(plain.activate().kind, 'selected');
  const integrated = createNaviox([item], { navigate: (route) => { called.push(route.href); return true; } });
  const result = await integrated.execute('home');
  assert.equal(result.status, 'success');
  assert.deepEqual(called, ['/']);
});

test('disabled, hidden, readOnly, context-filtered, and unknown commands never execute', async () => {
  let count = 0;
  const perform = () => ++count;
  const nav = createNaviox([
    { id: 'disabled', title: 'Disabled', disabled: true, perform },
    { id: 'hidden', title: 'Hidden', hidden: true, perform },
    { id: 'readOnly', title: 'ReadOnly', readOnly: true, perform },
    { id: 'secret', title: 'Secret', perform },
  ], { search: { filter: (item, context) => item.id !== 'secret' || context.admin === true } });
  for (const id of ['disabled', 'hidden', 'readOnly', 'secret', 'none']) {
    assert.equal((await nav.execute(id)).status, 'ignored');
  }
  nav.setContext({ admin: true });
  assert.equal((await nav.execute('secret')).status, 'success');
  assert.equal(count, 1);
});

test('shortcut parser supports platform Mod and validates invalid chords', () => {
  assert.deepEqual(parseNavioxShortcut('Mod+Shift+K', 'mac'), {
    key: 'k', ctrl: false, meta: true, alt: false, shift: true,
  });
  assert.equal(matchesNavioxShortcut('Control+P', { key: 'p', ctrlKey: true }), true);
  assert.equal(matchesNavioxShortcut('Mod+K', { key: 'k', metaKey: true }, 'mac'), true);
  assert.equal(matchesNavioxShortcut('Mod+K', { key: 'k', metaKey: true }, 'other'), false);
  assert.equal(matchesNavioxShortcut('G', { key: 'g', targetEditable: true }), false);
  assert.equal(matchesNavioxShortcut('Ctrl+G', { key: 'g', ctrlKey: true, targetEditable: true }), true);
  assert.equal(matchesNavioxShortcut('Ctrl+G', { key: 'g', ctrlKey: true, repeat: true }), false);
  assert.equal(matchesNavioxShortcut('Ctrl+G', { key: 'g', ctrlKey: true, isComposing: true }), false);
  assert.throws(() => parseNavioxShortcut(''), /nonempty/);
  assert.throws(() => parseNavioxShortcut('Ctrl+Ctrl+K'), /Duplicate/);
  assert.throws(() => parseNavioxShortcut('Ctrl+K+P'), /multiple/);
  assert.throws(() => parseNavioxShortcut('Ctrl+'), /Invalid/);
  assert.throws(() => parseNavioxShortcut('Ctrl'), /no key/);
});

test('shortcut dispatch toggles palette, respects page scope, priority and safe editable targets', async () => {
  const calls = [];
  const nav = createNaviox([
    { id: 'root', title: 'Root page', shortcuts: ['G'], perform: () => { calls.push('root'); } },
    { id: 'special', title: 'Special', shortcuts: ['G'], priority: 10, perform: () => { calls.push('special'); } },
    { id: 'parent', title: 'Parent' },
    { id: 'child', title: 'Child', parentId: 'parent', shortcutScope: 'page', shortcuts: ['Alt+D'], perform: () => { calls.push('child'); } },
  ], { shortcuts: { platform: 'mac', toggle: 'Mod+K' } });
  assert.equal(nav.handleShortcut({ key: 'k', metaKey: true }).handled, true);
  assert.equal(nav.getState().open, true);
  assert.equal(nav.handleShortcut({ key: 'g', targetEditable: true }).handled, false);
  const result = nav.handleShortcut({ key: 'g' });
  assert.equal(result.item.id, 'special');
  await result.execution;
  assert.deepEqual(calls, ['special']);
  assert.equal(nav.handleShortcut({ key: 'd', altKey: true }).handled, false);
  nav.open(); nav.pushPage('parent');
  assert.equal(nav.handleShortcut({ key: 'd', altKey: true }).item.id, 'child');
  assert.deepEqual(calls, ['special', 'child']);
  assert.equal(nav.handleShortcut({ key: 'k', metaKey: true, repeat: true }).handled, false);
  nav.destroy();
});

test('shortcut on a parent opens nested page and returns it without execution', () => {
  const nav = createNaviox([
    { id: 'settings', title: 'Settings', shortcuts: ['Ctrl+,'] },
    { id: 'child', title: 'Child', parentId: 'settings' },
  ]);
  const result = nav.handleShortcut({ key: ',', ctrlKey: true });
  assert.equal(result.handled, true);
  assert.equal(nav.getState().open, true);
  assert.equal(nav.getState().pageId, 'settings');
});

test('groups expose projections and collapsing removes them from keyboard selection', () => {
  const nav = createNaviox([
    { id: 'one', title: 'One', group: 'work' },
    { id: 'two', title: 'Two', group: 'pages' },
    { id: 'three', title: 'Three', group: 'work' },
    { id: 'free', title: 'Free' },
  ], { defaultOpen: true, groups: [
    { id: 'work', title: 'Projects', order: 20 },
    { id: 'pages', title: 'Pages', order: 10, defaultCollapsed: true },
  ] });
  assert.deepEqual(ids(nav.getState().results), ['one', 'three', 'free']);
  assert.equal(nav.getState().sections.find((s) => s.id === 'pages').total, 1);
  assert.equal(nav.getState().sections.find((s) => s.id === 'pages').collapsed, true);
  nav.setGroupCollapsed('pages', false);
  assert.deepEqual(ids(nav.getState().results), ['one', 'two', 'three', 'free']);
  nav.setActive('two');
  nav.toggleGroup('pages');
  assert.notEqual(nav.getState().activeId, 'two');
  assert.deepEqual(nav.getState().collapsedGroupIds, ['pages']);
  nav.setGroups([{ id: 'pages', title: 'Other title' }, { id: 'work', title: 'Projects' }]);
  assert.equal(nav.getState().sections.find((s) => s.id === 'pages').title, 'Other title');
});

test('optional groupResults reorders both sections and keyboard list consistently', () => {
  const nav = createNaviox([
    { id: 'a', title: 'A', group: 'work' },
    { id: 'b', title: 'B', group: 'pages' },
    { id: 'c', title: 'C', group: 'work' },
  ], { groupResults: true, groups: [
    { id: 'work', title: 'Work', order: 10 }, { id: 'pages', title: 'Pages', order: 1 },
  ] });
  assert.deepEqual(ids(nav.getState().results), ['b', 'a', 'c']);
  assert.deepEqual(nav.getState().sections.map((s) => s.id), ['pages', 'work']);
  nav.open();
  assert.equal(nav.getState().activeId, 'b');
  nav.move(1);
  assert.equal(nav.getState().activeId, 'a');
  const projection = sectionItems(nav.getItems(), nav.getGroups(), new Set(['work']), true);
  assert.deepEqual(ids(projection.visible), ['b']);
});

test('controlled parent receives page and back requests without mutating its owned controls', () => {
  const changes = [];
  const nav = createNaviox(pages, { controlled: {
    state: { open: true, query: '', activeId: 'settings' },
    onChange: (next, reason) => changes.push([next, reason]),
  } });
  nav.activate('settings');
  assert.equal(nav.getState().pageId, 'settings');
  assert.equal(changes.at(-1)[1], 'page');
  assert.equal(nav.getState().activeId, null);
  nav.syncControlledState(changes.at(-1)[0]);
  assert.equal(nav.getState().activeId, 'theme');
  nav.back();
  assert.equal(changes.at(-1)[1], 'back');
  nav.syncControlledState(changes.at(-1)[0]);
  assert.equal(nav.getState().activeId, 'settings');
  nav.destroy();
});

test('runtime registration immediately exposes nested actions and shortcut metadata is immutable', () => {
  const shortcuts = ['Ctrl+D'];
  const nav = createNaviox([{ id: 'tools', title: 'Tools' }]);
  const dispose = nav.register({ id: 'deploy', title: 'Deploy', parentId: 'tools', shortcuts });
  shortcuts.push('Alt+X');
  assert.deepEqual(nav.getItems()[1].shortcuts, ['Ctrl+D']);
  nav.open();
  assert.equal(nav.pushPage('tools'), true);
  assert.deepEqual(ids(nav.getState().results), ['deploy']);
  dispose();
  assert.deepEqual(nav.getState().results, []);
  nav.destroy();
});

test('maxResults counts visible items after collapsed groups are excluded', () => {
  const nav = createNaviox([
    { id: 'a', title: 'A', group: 'hidden' },
    { id: 'b', title: 'B', group: 'hidden' },
    { id: 'c', title: 'C', group: 'visible' },
    { id: 'd', title: 'D', group: 'visible' },
  ], { maxResults: 1, groups: [{ id: 'hidden', title: 'Hidden', defaultCollapsed: true }] });
  assert.deepEqual(ids(nav.getState().results), ['c']);
  assert.deepEqual(ids(nav.getState().sections.find((s) => s.id === 'visible').items), ['c']);
  assert.equal(nav.getState().sections.find((s) => s.id === 'hidden').total, 2);
  nav.setGroupCollapsed('hidden', false);
  assert.deepEqual(ids(nav.getState().results), ['a']);
});
