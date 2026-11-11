import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const release = readFileSync('.github/workflows/publish.yml', 'utf8');

test('release workflow verifies package version against pushed tag', () => {
  assert.match(release, /GITHUB_REF_NAME/);
  assert.match(release, /v\$\{VERSION\}/);
  assert.match(release, /exit 1/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/);
});
test('CI targets master and clean npm installs', () => {
  assert.match(ci, /branches: \[master\]/);
  assert.match(ci, /node: \[20, 22, 24\]/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run check/);
});
