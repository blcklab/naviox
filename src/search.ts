import type { NavioxItem, NavioxRankedItem, NavioxSearchOptions, NavioxSearchWeights } from './types.js';

const DEFAULT_WEIGHTS: NavioxSearchWeights = Object.freeze({
  title: 4, description: 1, group: 1, kind: 1, keywords: 2, aliases: 3,
});

/** Accent-insensitive token normalization, with no browser globals. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').trim();
}

function subsequenceScore(haystack: string, needle: string): number {
  let cursor = 0;
  let gaps = 0;
  let previous = -1;
  for (const character of needle) {
    const position = haystack.indexOf(character, cursor);
    if (position === -1) return 0;
    if (previous !== -1) gaps += position - previous - 1;
    previous = position;
    cursor = position + character.length;
  }
  return Math.max(1, 25 - gaps);
}

function fieldScore(value: string, token: string, weight: number): number {
  if (!value || !weight) return 0;
  if (value === token) return 120 * weight;
  if (value.startsWith(token)) return 90 * weight;
  if (value.split(/[\s\-_./]+/).some((word) => word.startsWith(token))) return 78 * weight;
  if (value.includes(token)) return 65 * weight;
  return subsequenceScore(value, token) * weight;
}

function builtinScore(item: NavioxItem, tokens: readonly string[], weights: NavioxSearchWeights): number {
  const fields = [
    [normalizeSearchText(item.title), weights.title],
    [normalizeSearchText(item.description ?? ''), weights.description],
    [normalizeSearchText(item.group ?? ''), weights.group],
    [normalizeSearchText(item.kind ?? ''), weights.kind],
    ...(item.keywords ?? []).map((value): [string, number] => [normalizeSearchText(value), weights.keywords]),
    ...(item.aliases ?? []).map((value): [string, number] => [normalizeSearchText(value), weights.aliases]),
  ] as readonly (readonly [string, number])[];
  let result = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [value, weight] of fields) best = Math.max(best, fieldScore(value, token, weight));
    if (!best) return 0; // Every token must match somewhere.
    result += best;
  }
  return result;
}

function resultLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 50;
}

/**
 * Pure ranked search. Default ordering is stable; priority only breaks score ties.
 * Custom score receives normalized query and tokens and must return a finite positive score to include a match.
 */
export function rankItems(
  items: readonly NavioxItem[],
  query: string,
  maxResults = 50,
  options: NavioxSearchOptions = {},
): NavioxRankedItem[] {
  const limit = resultLimit(maxResults);
  if (limit === 0) return [];
  const normalized = normalizeSearchText(query);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const context = options.context ?? {};
  const matches: NavioxRankedItem[] = [];
  items.forEach((item, index) => {
    if (item.hidden || (options.filter && !options.filter(item, context))) return;
    const score = !tokens.length ? 0 : (options.score
      ? options.score(item, normalized, tokens)
      : builtinScore(item, tokens, weights));
    if (tokens.length && (!Number.isFinite(score) || score <= 0)) return;
    matches.push({ item, index, score });
  });
  if (options.compare) {
    matches.sort((a, b) => {
      const comparison = options.compare!(a, b);
      return Number.isFinite(comparison) && comparison !== 0 ? comparison : a.index - b.index;
    });
  } else if (tokens.length) {
    matches.sort((a, b) => b.score - a.score || (b.item.priority ?? 0) - (a.item.priority ?? 0) || a.index - b.index);
  } else {
    // Preserve M0 source ordering unless callers explicitly specify priority.
    matches.sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0) || a.index - b.index);
  }
  return matches.slice(0, limit);
}

/** M0-compatible convenience API returning just items. */
export function searchItems(items: readonly NavioxItem[], query: string, maxResults = 50): NavioxItem[] {
  return rankItems(items, query, maxResults).map((match) => match.item);
}

/** A configured reusable search service for direct Vanilla JS and adapter use. */
export function createNavioxSearch(options: NavioxSearchOptions = {}) {
  return Object.freeze({
    rank: (items: readonly NavioxItem[], query: string, maxResults = 50) => rankItems(items, query, maxResults, options),
    search: (items: readonly NavioxItem[], query: string, maxResults = 50) => rankItems(items, query, maxResults, options).map((match) => match.item),
  });
}
