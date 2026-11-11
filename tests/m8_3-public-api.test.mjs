import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read = (p) => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
test('M8.3 source candidate and docs identify the current package', () => {
  assert.equal(pkg.name, "@blcklab/naviox");
  assert.equal(pkg.version, "0.1.0-alpha.7");
  assert.ok(read('README.md').includes(pkg.version));
  assert.ok(read('README.md').includes('docs/public-api.md'));
});
test('public package exports and documented APIs are present', () => {
  const entry = read('src/index.ts');
  for (const name of ["createNaviox", "createNavioxRegistry", "createNavioxSearch", "createNavioxHttpProvider"])
    assert.match(entry, new RegExp('\\b'+name+'\\b'), name);
  const guide = read('docs/public-api.md');
  for (const name of ["createNaviox", "createNavioxRegistry", "createNavioxSearch", "createNavioxHttpProvider"])
    assert.ok(guide.includes(name), name);
});
test('independent repository, public-only dependencies', () => {
  assert.equal('workspaces' in pkg, false);
  assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});
