#!/usr/bin/env node
/** Audit the actual npm file list, not just the source tree. No registry needed. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.workspaces) throw Error('Naviox packages must use independent repositories, not npm workspaces.');
if (!pkg.exports?.['.']) throw Error('Missing package root exports.');
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  if (typeof entry === 'string') {
    if (!existsSync(resolve(entry))) throw Error(`Unbuilt export: ${subpath}: ${entry}`);
  } else for (const [kind, target] of Object.entries(entry)) {
    if (typeof target === 'string' && !existsSync(resolve(target))) throw Error(`Unbuilt ${kind} export: ${target}`);
  }
}
const npmArgs = ['pack', '--dry-run', '--json', '--ignore-scripts'];
const pack = process.env.npm_execpath
  ? spawnSync(process.execPath, [process.env.npm_execpath, ...npmArgs], { encoding: 'utf8', timeout: 20000 })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32' });
if (pack.error) throw pack.error;
if (pack.status !== 0) throw Error(`npm pack audit failed: ${pack.stderr}`);
const metadata = JSON.parse(pack.stdout)[0];
if (metadata.name !== pkg.name || metadata.version !== pkg.version) throw Error('Packaged package identity does not match package.json.');
const files = metadata.files.map(file => file.path);
const prohibited = files.filter(path => !(
  path === 'package.json' || path === 'README.md' || path === 'LICENSE' || path.startsWith('dist/')
));
if (prohibited.length) throw Error(`Unexpected publish files: ${prohibited.join(', ')}`);
if (files.some(path => path.startsWith('dist/dist/'))) {
  throw Error('Nested dist/dist detected. Run npm run clean before rebuilding.');
}
if (!files.some(path => path.endsWith('.js')) || !files.some(path => path.endsWith('.d.ts'))) {
  throw Error('Package must contain both JavaScript and TypeScript declarations.');
}
for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })) {
  if (spec.startsWith('file:') || spec.startsWith('workspace:') || spec.startsWith('link:')) {
    throw Error(`Release may not depend on local source: ${name}@${spec}`);
  }
}
if (pkg.name === '@blcklab/naviox') {
  if (Object.keys(pkg.dependencies ?? {}).length) throw Error('Headless core must have zero runtime dependencies.');
} else {
  if (!/^0\.1\.0-alpha\.\d+$/.test(pkg.dependencies?.['@blcklab/naviox'] ?? '')) {
    throw Error('Adapter must declare an exact published core pre-release version.');
  }
  if (!files.includes('dist/styles.css')) throw Error('Adapter must publish its theme stylesheet.');
}
console.log(`Verified ${pkg.name}@${pkg.version}: ${files.length} public files, ${metadata.size} bytes unpacked.`);
