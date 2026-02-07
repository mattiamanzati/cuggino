# Changesets and CI

## Overview

The project uses [@changesets/cli](https://github.com/changesets/changesets) for version management and release automation. A GitHub Actions workflow handles CI checks and publishing to npm.

## Changeset Configuration

### Dependencies

Add to `devDependencies`:
```
@changesets/cli
@changesets/changelog-github
```

### `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.2/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "mattiamanzati/cuggino" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### `package.json` additions

Add `publishConfig` to `package.json`:
```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

## GitHub Actions

### Setup Action (`.github/actions/setup/action.yml`)

A reusable composite action for installing pnpm and dependencies:

```yaml
name: Setup
description: Perform standard setup and install dependencies using pnpm.

runs:
  using: composite
  steps:
    - name: Install pnpm
      uses: pnpm/action-setup@v3
    - name: Install node
      uses: actions/setup-node@v4
      with:
        cache: pnpm
        node-version: 24.12.0
    - name: Install dependencies
      shell: bash
      run: pnpm install
```

### Build Workflow (`.github/workflows/build.yml`)

A single workflow that handles both CI checks and releases:

```yaml
name: Build

on:
  workflow_dispatch:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
      packages: write
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      - name: Install dependencies
        uses: ./.github/actions/setup
      - run: pnpm check
      - run: pnpm test
      - run: pnpm build
      - name: Upgrade npm for OIDC support
        run: npm install -g npm@latest
      - name: Create Release Pull Request or Publish
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Workflow Behavior

- **On pull requests to `main`**: Runs `pnpm check`, `pnpm test`, and `pnpm build` as CI validation
- **On push to `main`**: Runs CI checks, then the `changesets/action` either:
  - Creates a "Version Packages" PR if there are pending changesets (bumps version, updates CHANGELOG.md)
  - Publishes to npm if the "Version Packages" PR was just merged (no pending changesets, version already bumped)
- **OIDC publishing**: Uses npm's OIDC token support (via `id-token: write` permission) instead of an `NPM_TOKEN` secret

## Release Workflow

1. Developer creates a changeset: `pnpm changeset`
2. Changeset file is committed with the PR
3. PR is merged to `main`
4. CI detects pending changesets → creates a "Version Packages" PR
5. "Version Packages" PR is merged → CI publishes to npm
