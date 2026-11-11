import test from 'node:test';
import assert from 'node:assert/strict';
import { createNaviox, searchItems } from '../dist/index.js';

const items = [
  { id: 'home', title: 'Home', group: 'Pages', href: '/' },
  { id: 'work', title: 'Project Work', description: 'Open-source software', keywords: ['repositories'], group: 'Pages' },
  { id: 'about', title: 'Àbout', group: 'Pages', disabled: true },
  { id: 'post', title: 'Building apps', group: 'Posts' },
];

test('empty query preserves source order', () => {
  assert.deepEqual(searchItems(items, '').map((item) => item.id), ['home', 'work', 'about', 'post']);
});
test('search is accent-insensitive, keyword-aware, and token-based', () => {
  assert.equal(searchItems(items, 'about')[0].id, 'about');
  assert.equal(searchItems(items, 'repositories')[0].id, 'work');
  assert.equal(searchItems(items, 'project software')[0].id, 'work');
  assert.equal(searchItems(items, 'missingword').length, 0);
});
test('search respects limit and does not mutate items', () => {
  assert.equal(searchItems(items, '', 2).length, 2);
  assert.deepEqual(items.map((item) => item.id), ['home', 'work', 'about', 'post']);
});
test('palette opens, navigates, selects, closes and resets query', () => {
  const palette = createNaviox(items);
  const events = [];
  const unsubscribe = palette.subscribe((state) => events.push([state.open, state.activeId]));
  palette.open();
  assert.equal(palette.getState().activeId, 'home');
  palette.handleKey('ArrowDown');
  assert.equal(palette.getState().activeId, 'work');
  palette.handleKey('ArrowDown');
  assert.equal(palette.getState().activeId, 'post'); // skips disabled
  palette.handleKey('ArrowDown');
  assert.equal(palette.getState().activeId, 'home'); // wraps
  palette.setQuery('Project');
  assert.equal(palette.getState().activeId, 'work');
  const result = palette.handleKey('Enter');
  assert.equal(result.handled, true);
  assert.equal(result.selected.id, 'work');
  assert.equal(palette.getState().open, false);
  assert.equal(palette.getState().query, '');
  assert.ok(events.length >= 5);
  unsubscribe();
  palette.destroy();
});
test('cannot select disabled or missing items', () => {
  const palette = createNaviox(items);
  palette.open();
  assert.equal(palette.select('about'), null);
  assert.equal(palette.select('does-not-exist'), null);
  assert.equal(palette.getState().open, true);
});
test('catalog changes preserve valid selection and fix invalid selection', () => {
  const palette = createNaviox(items);
  palette.open();
  palette.setActive('work');
  palette.setItems(items.filter((item) => item.id !== 'work'));
  assert.equal(palette.getState().activeId, 'home');
  palette.setQuery('nonexistent');
  assert.equal(palette.getState().activeId, null);
  assert.equal(palette.handleKey('Enter').selected, null);
});
test('controllers are independent', () => {
  const first = createNaviox(items);
  const second = createNaviox(items);
  first.open();
  first.setQuery('Home');
  assert.equal(second.getState().open, false);
  assert.equal(second.getState().query, '');
});
