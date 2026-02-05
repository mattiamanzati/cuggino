# CLI Structure

## Overview

The CLI command definitions are organized in a `src/cli/` folder, separate from the layer composition in `src/cli.ts`. Command declarations are pure — they define flags, descriptions, and handlers. Layer wiring and runtime bootstrap remain in `src/cli.ts`.

## Folder Layout

```
src/
  cli.ts                  # Entrypoint: layer composition, provides layers, runs the command
  cli/
    runCommand.ts         # "run" subcommand
    planCommand.ts        # "plan" subcommand
    watchCommand.ts       # "watch" subcommand
    setupCommand.ts       # "setup" subcommand
    command.ts            # Root command with subcommands registered
```

## `src/cli/flags.ts` — Shared Flags

This file is no longer needed. All configuration options (`specsPath`, `maxIterations`, `checkCommand`, `commit`, `audit`) are read exclusively from `.cuggino.json` via `StorageService.readConfig()`. There are no shared CLI flags.

The `focus` flag is only used by the `run` command, so it is defined inline in `runCommand.ts`. The `version` flag is defined inline in `command.ts`.

## `src/cli/runCommand.ts`

Defines the `run` subcommand. Only has the `focus` flag (defined inline). Configuration options are read from `.cuggino.json` via `StorageService.readConfig()`.

## `src/cli/planCommand.ts`

Defines the `plan` subcommand. Takes no flags. Configuration options are read from `.cuggino.json` via `StorageService.readConfig()`.

## `src/cli/watchCommand.ts`

Defines the `watch` subcommand. Takes no flags. Configuration options are read from `.cuggino.json` via `StorageService.readConfig()`.

## `src/cli/setupCommand.ts`

Defines the `setup` subcommand. Takes no flags — uses `Prompt` for interactive configuration.

## `src/cli/command.ts`

Defines the root `cuggino` command with the `version` flag (inline). Registers all four subcommands via `Command.withSubcommands`. Exports the composed root command.

```typescript
// Pseudocode
import { runCommand } from "./runCommand.js"
import { planCommand } from "./planCommand.js"
import { watchCommand } from "./watchCommand.js"
import { setupCommand } from "./setupCommand.js"

export const root = Command.make("cuggino", {
  version: Flag.boolean("version").pipe(Flag.withAlias("v"))
}).pipe(
  Command.withDescription("Autonomous coder loop"),
  Command.withSubcommands([runCommand, planCommand, watchCommand, setupCommand])
)
```

## `src/cli.ts` — Entrypoint

Imports the root command from `src/cli/command.ts`. Responsible for:

1. `servicesLayer` — full layer composition (services, platform)
2. Calling `Command.run` on the root command, providing layers, and running via `NodeRuntime.runMain`

Configuration values are read directly from `.cuggino.json` via `StorageService.readConfig()` in each command handler, not through a config provider chain.

The `CliError` class also stays in `src/cli.ts` (or moves to the command file that uses it — `planCommand.ts`).

## What Does NOT Move

Everything outside of command definitions stays in place:

- `src/StorageService.ts`, `src/LoopService.ts`, `src/WatchService.ts`, etc.
- `src/AgentPrompts.ts`, `src/CliOutput.ts`, `src/extractMarkers.ts`
- Event types (`src/LoopEvent.ts`, `src/WatchLoopEvent.ts`, etc.)
- This project does not export a public API module. There is no `src/index.ts` barrel file. The CLI entrypoint (`src/cli.ts`) is the only entry point.
