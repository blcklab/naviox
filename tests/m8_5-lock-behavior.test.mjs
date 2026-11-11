import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const verifier = fileURLToPath(new URL('../scripts/verify-lock.mjs', import.meta.url));

function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'naviox-lock-'));
  try {
    const pkg = { name: '@example/naviox-fixture', version: '0.1.0-alpha.1', dependencies: { probe: '^1.0.0' } };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies }, 'node_modules/probe': { version: '1.2.0', resolved: 'https://registry.npmjs.org/probe/-/probe-1.2.0.tgz', integrity: 'sha512-fixtureplaceholder' } } };
    return fn(dir, lock);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const execute = (dir) => spawnSync(process.execPath, [verifier], { cwd: dir, encoding: 'utf8' });

test('lock verifier rejects missing lockfile', () => fixture((dir) => {
  const run = execute(dir);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Missing genuine package-lock/);
}));

test('lock verifier rejects unresolved or integrity-free dependencies', () => fixture((dir, lock) => {
  delete lock.packages['node_modules/probe'].integrity;
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  const run = execute(dir);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /integrity/);
}));

test('lock verifier rejects drift between manifest and lockfile', () => fixture((dir, lock) => {
  lock.packages[''].dependencies.probe = '^2.0.0';
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  const run = execute(dir);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /differs from package.json/);
}));
