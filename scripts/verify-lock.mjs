#!/usr/bin/env node
/** Check that a real npm package-lock v2/3 belongs to this exact repository. */
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(existsSync('package-lock.json'), 'Missing genuine package-lock.json; generate with npm install on a connected machine.');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert((lock.lockfileVersion ?? 0) >= 2, 'Unsupported lockfileVersion');
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages?.['']?.name, pkg.name);
assert.equal(lock.packages?.['']?.version, pkg.version);
for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  assert.deepEqual(lock.packages[''][key] ?? {}, pkg[key] ?? {}, `Lockfile ${key} differs from package.json`);
}
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const entry = lock.packages[`node_modules/${name}`];
  assert(entry?.version, `Missing resolved dependency: ${name}`);
  assert(typeof entry.resolved === 'string' && entry.resolved.startsWith('https://'), `Dependency ${name} is not resolved to a registry package`);
  assert(typeof entry.integrity === 'string' && entry.integrity.startsWith('sha'), `Dependency ${name} has no integrity hash`);
}
console.log(`${pkg.name}@${pkg.version}: real dependency lockfile metadata verified`);
