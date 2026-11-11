import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scope = [ 'README.md', ...readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => 'docs/' + name) ];
const errors = [];
const files = new Map(scope.map(name => [name, readFileSync(join(root, name), 'utf8')]));
for (const [file, raw] of files) {
  // Ignore code fences and inline examples; only validate actual Markdown links.
  const prose = raw.replace(/```[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/(?<!!)\]\(([^)]+)\)/g)) {
    const link = match[1].trim().split(/\s+["']/)[0];
    if (/^(?:https?:|mailto:|#|data:)/i.test(link)) continue;
    const pathname = decodeURIComponent(link.split('#')[0]);
    if (!pathname) continue;
    if (!existsSync(resolve(dirname(join(root,file)), pathname))) errors.push(`${file}: broken link ${link}`);
  }
}
const home = files.get('README.md');
if (!home.includes(pkg.name)) errors.push('README must mention the exact npm package name');
if (!home.includes(pkg.version)) errors.push('README must show the current package version');
for (const path of ['docs/public-api.md','docs/getting-started.md','docs/compatibility.md']) {
  if (!existsSync(join(root,path))) errors.push(`Missing maintained documentation: ${path}`);
}
// The default export surface is exactly the public entrypoint; avoid deep imports.
const entry = readFileSync(join(root, 'src/index.ts'), 'utf8');
for (const pattern of ['NavioxPalette','NavioxMegaMenu','NavioxAutocomplete']) {
  if (pkg.name !== '@blcklab/naviox' && !entry.includes(`{ ${pattern} }`)) errors.push(`Missing public export: ${pattern}`);
}
if (pkg.name !== '@blcklab/naviox') {
  if (!pkg.exports?.['./styles.css']) errors.push('Missing documented CSS subpath export');
  if (!pkg.peerDependencies) errors.push('Framework must remain a peer dependency');
  if (!pkg.dependencies?.['@blcklab/naviox']) errors.push('Adapter must depend on public core package');
}
if ('workspaces' in pkg) errors.push('This must remain an independent repository');
if (pkg.name === '@blcklab/naviox' && 'dependencies' in pkg && Object.keys(pkg.dependencies ?? {}).length) errors.push('Core must not gain runtime dependencies');
if (errors.length) { console.error(errors.join('\n')); process.exitCode=1; }
else console.log(`Documentation/public export checks passed: ${pkg.name}@${pkg.version} (${scope.length} Markdown files)`);
