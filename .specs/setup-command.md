# Setup Command

## Overview

The `cuggino setup` command interactively configures the project. It prompts the user for each setting, writes the result to `.cuggino.json`, and ensures the folder structure exists. It can be run at any time — on first use to initialize, or later to update settings.

## Command

```bash
cuggino setup
```

No options. Everything is configured interactively.

## Behavior

1. Ensure `.cuggino/` folder structure exists
2. Read existing `.cuggino.json` (for pre-filling defaults)
3. Prompt the user for each setting (see below)
4. Write the result to `.cuggino.json`
5. Print a summary of the saved configuration

### Prompts

Each prompt pre-fills with the current value from the existing config file. If no config exists, built-in defaults are used.

**Known limitation:** The `maxIterations` integer prompt and the `notify` select prompt do not currently pre-fill the existing value.

| Order | Setting | Prompt type | Default | Description |
|-------|---------|-------------|---------|-------------|
| 1 | `specsPath` | Text | `.specs` | Path to the specifications folder |
| 2 | `maxIterations` | Integer (min: 1) | — | Maximum iterations per loop run |
| 3 | `setupCommand` | Text | _(empty)_ | Command to run after planning, before implementation (leave empty to skip) |
| 4 | `checkCommand` | Text | _(empty)_ | Command to run before implementing and reviewing agents (leave empty to skip) |
| 5 | `commit` | Toggle | `false` | Auto-commit after each implementing agent invocation |
| 6 | `push` | Text | _(empty)_ | Remote/branch to push to after each commit (leave empty to skip) |
| 7 | `audit` | Toggle | `false` | Run background audit agent during idle time |
| 8 | `notify` | Select | `none` | Notification method when watch mode is idle (`none`, `osx-notification`) |

### Prompt Messages

- `specsPath`: "Path to the specifications folder"
- `maxIterations`: "Maximum iterations per loop run"
- `setupCommand`: "Setup command (install deps, build, etc.) — leave empty to skip"
- `checkCommand`: "Check command (linting, type checking, tests) — leave empty to skip"
- `commit`: "Auto-commit after each implementation step"
- `push`: "Push to remote after each commit (e.g., origin/main) — leave empty to skip"
- `audit`: "Run audit agent during idle time"
- `notify`: "Notification method when watch mode is idle"

## Config File

### Location

`.cuggino.json` in the project root.

### Schema

See the `CugginoConfig` schema definition in [storage.md](./storage.md). The schema is the single source of truth for config structure and defaults.

### Config Usage

Configuration values are read directly from `.cuggino.json` via `StorageService.readConfig()` in each command handler. There are no CLI flag overrides — the config file is the single source of truth.
