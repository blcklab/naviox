import type {
  NavioxHttpClient, NavioxHttpProviderOptions, NavioxProvider, NavioxProviderRequest,
} from './types.js';

/** HTTP transport adapter. No implicit network traffic, storage, or global fetch dependency. */
export function createNavioxHttpProvider(options: NavioxHttpProviderOptions): NavioxProvider {
  if (!options || !options.id?.trim() || typeof options.client !== 'function'
    || typeof options.mapResponse !== 'function' || !options.url?.trim()) {
    throw new TypeError('HTTP provider requires id, url, client and mapResponse');
  }
  const isAbsolute = /^https?:\/\//i.test(options.url);
  if (!isAbsolute && !options.url.startsWith('/')) throw new TypeError('HTTP provider URL must be http(s) or root-relative');
  if (!isAbsolute && options.url.startsWith('//')) throw new TypeError('Protocol-relative URLs are not supported');
  // Parse once, preserving base query parameters; JS/TS hosts provide URL and URLSearchParams.
  const parsed = new URL(options.url, 'https://naviox.invalid');
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new TypeError('Unsupported HTTP provider URL protocol');
  if (parsed.username || parsed.password) throw new TypeError('HTTP provider URL must not contain credentials');
  const base = isAbsolute ? parsed.origin + parsed.pathname : parsed.pathname;
  const initial = new URLSearchParams(parsed.search);
  const client: NavioxHttpClient = options.client;
  return Object.freeze({
    id: options.id,
    priority: options.priority,
    debounceMs: options.debounceMs,
    async search(request: NavioxProviderRequest) {
      if (request.signal.aborted) throw new Error('HTTP provider request aborted');
      const params = new URLSearchParams(initial);
      const values = options.params?.(request) ?? {
        q: request.query, cursor: request.cursor, limit: request.limit, pageId: request.pageId,
      };
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined) params.delete(key);
        else params.set(key, String(value));
      }
      const search = params.toString();
      const url = `${base}${search ? `?${search}` : ''}${parsed.hash}`;
      const headers = typeof options.headers === 'function' ? options.headers(request) : options.headers;
      const response = await client(url, { signal: request.signal, headers });
      if (!response.ok) throw new Error(`Naviox HTTP provider "${options.id}" responded with status ${response.status}`);
      return options.mapResponse(await response.json(), request);
    },
  });
}
