import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const release = readFileSync('.github/workflows/publish.yml', 'utf8');
const pkg = JSON.parse(readFileSync('package.json','utf8'));

test('prereleases use next; stable versions use latest', () => {
  assert.match(release, /\$\{VERSION\}.*\*-\*/);
  assert.match(release, /NPM_DIST_TAG=next/);
  assert.match(release, /NPM_DIST_TAG=latest/);
  assert.match(release, /--tag "\$NPM_DIST_TAG"/);
});
test('tag workflow runs from a single core repository', () => {
  assert.equal(pkg.name, '@blcklab/naviox');
  assert.ok(!pkg.workspaces);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.match(release, /npm ci/);
  assert.match(release, /npm run check/);
});
test('publish keeps GitHub provenance and token configuration', () => {
  assert.match(release, /id-token: write/);
  assert.match(release, /--provenance/);
  assert.match(release, /secrets.NPM_TOKEN/);
});
