# Development and publishing

Naviox core is maintained as **one Git repository and one npm package**. Vue and React have their own repositories.

## Local checks

```bash
npm install
npm run check
npm run bench:check
npm pack --dry-run
```

Commit the actual `package-lock.json` produced by npm. GitHub CI uses `npm ci` on Node 20, 22 and 24. `dist/` and `.internal/` are intentionally not tracked. The npm package only contains built JavaScript, declarations, `README.md`, and `LICENSE`.

## Publish with a Git tag

The workflow is intentionally simple. Once the `master` branch is green and npm publishing is configured:

```bash
git add .
git commit -m "Prepare Naviox release"
git push origin master
git tag v0.1.0-alpha.7
git push origin v0.1.0-alpha.7
```

The Git tag must match the version in `package.json`. An alpha, beta or RC goes to npm's `next` tag. A stable version goes to `latest`. The publish job runs `npm ci` and `npm run check` before `npm publish`.

Set up a GitHub Actions environment named `npm` and a repository secret named `NPM_TOKEN` with permission to publish `@blcklab/naviox`. Provenance also requires the configured npm/GitHub association. Do not commit credentials.

**Important:** if `package-lock.json` is missing, the job stops at `npm ci`. Generate and commit it on a connected machine rather than writing one by hand. Do not tag a version that already exists on npm.

[Back to documentation](index.md).
