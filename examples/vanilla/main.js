import { createNaviox } from '../../dist/index.js';

const catalog = [
  { id: 'home', title: 'Home', description: 'Return to the beginning', group: 'Pages', href: '#home', preview: { description: 'Welcome to Naviox. A search-driven interface for the things you build.', meta: [{ label: 'Type', value: 'Page' }] } },
  { id: 'about', title: 'About', description: 'The story behind the developer', group: 'Pages', href: '#about', preview: { description: 'A little about the person who builds the projects.', meta: [{ label: 'Type', value: 'Page' }, { label: 'Link', value: '/about' }] } },
  { id: 'work', title: 'My craft', description: 'Projects, tools, and experiments', group: 'Pages', href: '#work', keywords: ['portfolio', 'projects'], preview: { description: 'A collection of software worth sharing.', meta: [{ label: 'Type', value: 'Page' }] } },
  { id: 'naviox', title: 'Naviox', description: 'Keyboard-first command palette', group: 'Projects', href: '#naviox', keywords: ['navigation', 'search'], preview: { description: 'Framework-agnostic TypeScript core. Independent Vue and React packages.', meta: [{ label: 'Type', value: 'Open source' }, { label: 'Package', value: '@blcklab/naviox' }] } },
  { id: 'tessiox', title: 'Tessiox', description: 'Periodic-style layout library', group: 'Projects', href: '#tessiox', preview: { description: 'A tile-based system for creative portfolios.', meta: [{ label: 'Type', value: 'Open source' }] } },
  { id: 'contact', title: 'Contact', description: 'Say hello', group: 'Pages', href: '#contact', preview: { description: 'A place for questions and collaboration.', meta: [{ label: 'Type', value: 'Page' }] } },
  { id: 'settings', title: 'Settings', description: 'Appearance and demo commands', group: 'Commands', shortcuts: ['Alt+S'], preview: { description: 'Open a nested menu for live M2 command workflows.' } },
  { id: 'theme', title: 'Choose theme', parentId: 'settings', description: 'Switch the page appearance' },
  { id: 'light', title: 'Light theme', parentId: 'theme', closeOnExecute: true,
    perform: () => { document.body.style.background = '#f1f1f2'; document.body.style.color = '#252629'; return 'light'; } },
  { id: 'dark', title: 'Dark theme', parentId: 'theme', closeOnExecute: true,
    perform: () => { document.body.style.background = '#18191d'; document.body.style.color = '#fafafb'; return 'dark'; } },
  { id: 'simulate', title: 'Simulate a task', description: 'Show async progress reporting', parentId: 'settings', closeOnExecute: false,
    perform: async ({ signal, reportProgress }) => {
      reportProgress({ message: 'Checking workflow', current: 1, total: 2 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (signal.aborted) return;
      reportProgress({ message: 'Completed', current: 2, total: 2 });
      return 'finished';
    } },
];

// Simulated remote content: the provider contract is the same for a real HTTP API.
// HTTP clients and browser state remain outside the framework-neutral core.
const documents = Array.from({ length: 36 }, (_, n) => ({
  id: `doc-${n + 1}`, title: `Naviox guide · Chapter ${n + 1}`,
  description: ['Provider architecture', 'Keyboard interactions', 'Design tokens', 'Search relevance'][n % 4],
  group: 'Docs', preview: { description: `Remote documentation result ${n + 1} from the M3 async provider.`,
    meta: [{ label: 'Source', value: 'Simulated documentation API' }, { label: 'Type', value: 'Guide' }] },
}));
const controller = createNaviox(catalog, {
  shortcuts: { platform: /Mac|iPhone|iPad/i.test(navigator.userAgent) ? 'mac' : 'other' },
  maxResults: 75,
  providers: { debounceMs: 160, pageSize: 8, cache: { ttlMs: 30_000, maxEntries: 30 }, initial: [{
    id: 'docs', priority: -1,
    async search({ query, pageId, cursor, limit, signal }) {
      await new Promise((resolve) => setTimeout(resolve, 170));
      if (signal.aborted || pageId !== null) return { items: [] };
      const match = documents.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
      const offset = cursor ? Number(cursor) : 0;
      const slice = match.slice(offset, offset + limit);
      return { items: slice, nextCursor: offset + limit < match.length ? String(offset + limit) : null };
    },
  }] },
  preferences: { storage: window.localStorage, key: 'naviox:m3-playground', maxRecent: 12,
    prioritizeOnEmptyQuery: true },
});
const dialog = document.querySelector('#palette');
const input = document.querySelector('#search');
const list = document.querySelector('#results');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const empty = document.querySelector('#empty');
const crumb = document.querySelector('#breadcrumb');
const back = document.querySelector('#back');
const loadMore = document.querySelector('#load-more');
let previousFocus = null;

function open() { previousFocus = document.activeElement; controller.open(); }
function perform(item) { if (item.href) window.location.assign(item.href); }
function choose(id) {
  const result = controller.activate(id);
  if (result.kind === 'selected' && result.item) perform(result.item);
}
function render(state) {
  if (state.open && !dialog.open) { dialog.showModal(); input.focus(); }
  else if (!state.open && dialog.open) { dialog.close(); previousFocus?.focus(); }
  input.value = state.query;
  crumb.textContent = state.breadcrumbs.length ? state.breadcrumbs.map((part) => part.title).join(' / ') : 'BROWSE';
  back.hidden = state.pageStack.length === 0;
  list.replaceChildren();
  state.results.forEach((item, index) => {
    const row = document.createElement('li');
    row.id = `naviox-option-${index}`;
    row.className = `naviox-option${item.id === state.activeId ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`;
    row.role = 'option';
    row.setAttribute('aria-selected', String(item.id === state.activeId));
    if (item.disabled) row.setAttribute('aria-disabled', 'true');
    const left = document.createElement('div');
    left.className = 'naviox-option-text';
    const title = document.createElement('span');
    title.className = 'naviox-option-title';
    title.textContent = item.title;
    const desc = document.createElement('span');
    desc.className = 'naviox-option-description';
    desc.textContent = item.description ?? '';
    left.append(title, desc);
    const group = document.createElement('span');
    group.className = 'naviox-option-group';
    group.textContent = item.group ?? '';
    row.append(left, group);
    const bookmark = document.createElement('button');
    bookmark.type = 'button';
    bookmark.className = 'naviox-bookmark';
    const isFavorite = state.favoriteIds.includes(item.id);
    bookmark.textContent = isFavorite ? '★' : '☆';
    bookmark.setAttribute('aria-label', isFavorite ? `Unfavorite ${item.title}` : `Favorite ${item.title}`);
    bookmark.title = 'Toggle favorite';
    bookmark.addEventListener('mousedown', (event) => event.preventDefault());
    bookmark.addEventListener('click', (event) => { event.stopPropagation(); controller.toggleFavorite(item.id); });
    row.append(bookmark);
    row.addEventListener('mouseenter', () => controller.setActive(item.id));
    row.addEventListener('mousedown', (event) => event.preventDefault());
    row.addEventListener('click', () => choose(item.id));
    list.append(row);
  });
  empty.hidden = state.results.length > 0 || state.providersLoading;
  loadMore.hidden = !state.providers.docs?.hasMore || state.providers.docs.status === 'loading';
  const task = state.execution;
  status.textContent = task.status === 'running' ? (task.progress?.message ?? 'Running…')
    : task.status === 'error' ? 'Command failed'
    : task.status === 'success' ? 'Command completed'
    : state.providersLoading ? `Searching… ${state.results.length} shown`
    : `${state.results.length} results${state.providers.docs?.status === 'error' ? ' · Remote search failed' : ''}`;
  const selectedForScroll = state.results.findIndex((item) => item.id === state.activeId);
  if (state.open && selectedForScroll >= 0) list.children.item(selectedForScroll)?.scrollIntoView({ block: 'nearest' });
  const activeIndex = state.results.findIndex((item) => item.id === state.activeId);
  if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `naviox-option-${activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
  const active = state.results[activeIndex];
  preview.replaceChildren();
  if (!active) return;
  const cover = document.createElement('div');
  cover.className = 'naviox-preview-image naviox-preview-placeholder';
  cover.textContent = active.title.slice(0, 1);
  const heading = document.createElement('h3');
  heading.className = 'naviox-preview-title';
  heading.textContent = active.title;
  const body = document.createElement('p');
  body.className = 'naviox-preview-description';
  body.textContent = active.preview?.description ?? active.description ?? '';
  preview.append(cover, heading, body);
  for (const row of active.preview?.meta ?? []) {
    const meta = document.createElement('div');
    meta.className = 'naviox-meta';
    const key = document.createElement('span');
    key.textContent = row.label;
    const value = document.createElement('span');
    value.textContent = row.value;
    meta.append(key, value);
    preview.append(meta);
  }
}

controller.subscribe(render);
render(controller.getState());
document.querySelector('#trigger').addEventListener('click', open);
back.addEventListener('click', () => controller.back());
loadMore.addEventListener('click', () => { void controller.loadMore('docs'); });
input.addEventListener('input', () => controller.setQuery(input.value));
input.addEventListener('keydown', (event) => {
  const result = controller.handleKey(event.key);
  if (!result.handled) return;
  event.preventDefault();
  if (result.selected && !result.execution) perform(result.selected);
});
dialog.addEventListener('cancel', (event) => { event.preventDefault(); controller.close(); });
dialog.addEventListener('click', (event) => { if (event.target === dialog) controller.close(); });
document.addEventListener('keydown', (event) => {
  const targetEditable = event.target instanceof HTMLElement && (event.target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
  const result = controller.handleShortcut({
    key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
    shiftKey: event.shiftKey, altKey: event.altKey, repeat: event.repeat,
    isComposing: event.isComposing, targetEditable,
  });
  if (result.handled) event.preventDefault();
});
