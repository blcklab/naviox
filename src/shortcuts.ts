import type { NavioxShortcutEvent } from './types.js';

export type NavioxPlatform = 'mac' | 'other';

const aliases: Readonly<Record<string, string>> = {
  command: 'meta', cmd: 'meta', '⌘': 'meta', meta: 'meta', win: 'meta',
  control: 'ctrl', ctl: 'ctrl', ctrl: 'ctrl', '⌃': 'ctrl',
  option: 'alt', alt: 'alt', '⌥': 'alt',
  shift: 'shift', '⇧': 'shift',
  return: 'enter', esc: 'escape', space: ' ', spacebar: ' ',
  arrowup: 'arrowup', arrowdown: 'arrowdown', arrowleft: 'arrowleft', arrowright: 'arrowright',
};

function keyName(value: string): string {
  const normalized = value.toLocaleLowerCase('en');
  return aliases[normalized] ?? normalized;
}

/** Parse and validate a platform-aware single-stroke shortcut; throws on invalid strings. */
export function parseNavioxShortcut(shortcut: string, platform: NavioxPlatform = 'other') {
  if (!shortcut.trim()) throw new TypeError('Shortcut must be nonempty');
  const parts = shortcut.split('+').map((part) => part.trim());
  if (parts.some((part) => !part)) throw new TypeError(`Invalid shortcut: ${shortcut}`);
  let ctrl = false, meta = false, shift = false, alt = false;
  let key: string | null = null;
  for (const part of parts) {
    const name = keyName(part);
    const resolved = name === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : name;
    if (resolved === 'ctrl' || resolved === 'meta' || resolved === 'shift' || resolved === 'alt') {
      if ((resolved === 'ctrl' && ctrl) || (resolved === 'meta' && meta)
        || (resolved === 'shift' && shift) || (resolved === 'alt' && alt)) {
        throw new TypeError(`Duplicate shortcut modifier: ${shortcut}`);
      }
      if (resolved === 'ctrl') ctrl = true;
      if (resolved === 'meta') meta = true;
      if (resolved === 'shift') shift = true;
      if (resolved === 'alt') alt = true;
    } else {
      if (key !== null) throw new TypeError(`Shortcut contains multiple keys: ${shortcut}`);
      key = resolved;
    }
  }
  if (key === null) throw new TypeError(`Shortcut has no key: ${shortcut}`);
  return Object.freeze({ key, ctrl, meta, alt, shift });
}

/** Match without a DOM KeyboardEvent. Composed keystrokes and repeats never trigger. */
export function matchesNavioxShortcut(
  shortcut: string,
  event: NavioxShortcutEvent,
  platform: NavioxPlatform = 'other',
): boolean {
  if (event.repeat || event.isComposing || event.key === 'Dead' || event.key === 'Process') return false;
  const spec = parseNavioxShortcut(shortcut, platform);
  if (event.targetEditable && !spec.ctrl && !spec.meta && !spec.alt) return false;
  return keyName(event.key) === spec.key
    && Boolean(event.ctrlKey) === spec.ctrl && Boolean(event.metaKey) === spec.meta
    && Boolean(event.shiftKey) === spec.shift && Boolean(event.altKey) === spec.alt;
}
