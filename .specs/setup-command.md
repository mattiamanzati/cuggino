# Setup Command

## Overview

The `cuggino setup` command interactively configures the project. It prompts the user for each setting, writes the result to `.cuggino.json`, and ensures the folder structure exists. It can be run at any time — on first use to initialize, or later to update settings.

## Command

```bash
cuggino setup
```

No options. Everything is configured interactively.

## Behavior

1. Ensure `.cuggino/` folder structure exists (via `StorageService`)
2. Read existing `.cuggino.json` via `StorageService` (for pre-filling defaults)
3. Parse the JSON content using Effect Schema (see below)
4. Prompt the user for each setting (see below)
5. Write the result to `.cuggino.json`
6. Print a summary of the saved configuration

### Prompts

Each prompt pre-fills with the current value from the existing config file. If no config exists, built-in defaults are used.

| Order | Setting | Prompt type | Default | Description |
|-------|---------|-------------|---------|-------------|
| 1 | `specsPath` | `Prompt.text` | `.specs` | Path to the specifications folder |
| 2 | `maxIterations` | `Prompt.integer` (min: 1) | — | Maximum iterations per loop run (no default pre-fill; `Prompt.integer` doesn't support it) |
| 3 | `checkCommand` | `Prompt.text` | `pnpm check && pnpm test` | Command to run before implementing and reviewing agents |
| 4 | `commit` | `Prompt.toggle` | `false` | Auto-commit after each implementing agent invocation |
| 5 | `audit` | `Prompt.toggle` | `false` | Run background audit agent during idle time |

### Prompt Messages

- `specsPath`: "Path to the specifications folder"
- `maxIterations`: "Maximum iterations per loop run"
- `checkCommand`: "Check command (linting, type checking, tests)"
- `commit`: "Auto-commit after each implementation step"
- `audit`: "Run audit agent during idle time"

## Config File

### Location

`.cuggino.json` — path resolved via `StorageService.rootDir`, not hardcoded.

### Schema

The config file is parsed using an Effect Schema with all fields optional and with defaults:

```typescript
const CugginoConfig = Schema.Struct({
  specsPath: Schema.String.pipe(Schema.withDecodingDefaultKey(() => ".specs")),
  maxIterations: Schema.Number.pipe(Schema.withDecodingDefaultKey(() => 10)),
  checkCommand: Schema.String.pipe(Schema.withDecodingDefaultKey(() => "pnpm check && pnpm test")),
  commit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false)),
  audit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false))
})
```

### Config Usage

Configuration values are read directly from `.cuggino.json` via `StorageService.readConfig()` in each command handler. There are no CLI flag overrides — the config file is the single source of truth for these settings.

Commands that need configuration (e.g., `run`, `watch`, `plan`) call `StorageService.readConfig()` at the start of their handler to get the current config values.

## Implementation

The command uses the Effect CLI `Prompt` module (`effect/unstable/cli`):

```typescript
import { Prompt } from "effect/unstable/cli"
```

1. Call `StorageService.readConfig()` to get current config (with defaults)
2. Build prompts using `Prompt.all` with values from the current config as defaults
3. Run the prompts with `Prompt.run`
4. Call `StorageService.writeConfig(result)` to persist
