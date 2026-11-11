# Compatibility

Naviox core is written in TypeScript and published as modern ESM. It targets Node.js 20 or newer and browsers with standard modern JavaScript features. It has no runtime npm dependencies.

The core works with plain JavaScript or TypeScript. It doesn't require Vue or React and doesn't install DOM listeners. The optional Vue and React packages live in separate repositories, with their own framework versions and release cycles.

## Versioning

The current source is `0.1.0-alpha.7`. During alpha releases, APIs may change between versions; pin the version if your application needs reproducible builds. The `next` npm dist-tag identifies prereleases once published.

For a stable release, changes will follow the published versioning policy. A source ZIP or a local npm pack is not evidence that a package is already available on npm.

See [Getting started](getting-started.md) for the quickest way to try the API.
