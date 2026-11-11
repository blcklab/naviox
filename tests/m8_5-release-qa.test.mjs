import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));

test('simple tag-based publishing uses real npm dependency install and check', () => {
  const publish = read('.github/workflows/publish.yml');
  assert.match(publish, /npm ci/);
  assert.match(publish, /npm run check/);
  assert.match(publish, /npm publish --access public --provenance/);
  assert.ok(!pkg.workspaces);
});
test('public npm files exclude docs, examples, tests and internal notes', () => {
  assert.deepEqual(pkg.files, ['dist','README.md','LICENSE']);
  assert.match(read('.gitignore'), /\.internal\//);
  assert.ok(existsSync('docs/index.md'));
  assert.ok(existsSync('docs/getting-started.md'));
  assert.ok(!existsSync('docs/m1-validation.md'));
});
test('build clears stale dist output and package audit detects nested dist', () => {
  assert.match(pkg.scripts.build, /npm run clean/);
  assert.match(read('scripts/verify-package.mjs'), /dist\/dist\//);
});
