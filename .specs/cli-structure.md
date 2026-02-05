# CLI Structure

## Overview

The CLI command definitions are organized in a `src/cli/` folder, separate from the layer composition in `src/cli.ts`. Command declarations are pure — they define flags, descriptions, and handlers. Layer wiring and runtime bootstrap remain in `src/cli.ts`.

## Folder Layout

```
src/
  cli.ts                  # Entrypoint: layer composition, provides layers, runs the command
  cli/
    runCommand.ts         # "run" subcommand
    watchCommand.ts       # "watch" subcommand
    setupCommand.ts       # "setup" subcommand
    command.ts            # Root command: default handler runs PM mode, subcommands registered
```

## Root Command — `src/cli/command.ts`

Defines the root `cuggino` command with the `version` flag (inline). Registers subcommands via `Command.withSubcommands`.

When invoked **without a subcommand**, the root command handler starts PM mode (project manager) — an interactive Claude session for discussing specs, managing the backlog, and resolving issues. See [pm-command.md](./pm-command.md) for full details.

The `CliError` class is defined in `src/cli/command.ts`.

```typescript
// Pseudocode
import { runCommand } from "./runCommand.js"
import { watchCommand } from "./watchCommand.js"
import { setupCommand } from "./setupCommand.js"

export const root = Command.make("cuggino", {
  version: Flag.boolean("version").pipe(Flag.withAlias("v"))
}, (args) => {
  // Default handler: start PM mode
  // Build PM prompt, call LlmAgent.interactive()
}).pipe(
  Command.withDescription("Autonomous coder loop"),
  Command.withSubcommands([runCommand, watchCommand, setupCommand])
)
```

## `src/cli/runCommand.ts`

Defines the `run` subcommand. Only has the `focus` flag (defined inline). Configuration options are read from `.cuggino.json` via `StorageService.readConfig()`.

## `src/cli/watchCommand.ts`

Defines the `watch` subcommand. Takes no flags. Configuration options are read from `.cuggino.json` via `StorageService.readConfig()`.

## `src/cli/setupCommand.ts`

Defines the `setup` subcommand. Takes no flags — uses `Prompt` for interactive configuration.

## `src/cli.ts` — Entrypoint

Imports the root command from `src/cli/command.ts`. Responsible for:

1. `servicesLayer` — full layer composition (services, platform)
2. Calling `Command.run` on the root command, providing layers, and running via `NodeRuntime.runMain`

Configuration values are read directly from `.cuggino.json` via `StorageService.readConfig()` in each command handler, not through a config provider chain.

## What Does NOT Move

Everything outside of command definitions stays in place:

- `src/StorageService.ts`, `src/LoopService.ts`, `src/WatchService.ts`, etc.
- `src/AgentPrompts.ts`, `src/CliOutput.ts`, `src/extractMarkers.ts`
- Event types (`src/LoopEvent.ts`, `src/WatchLoopEvent.ts`, etc.)
- This project does not export a public API module. There is no `src/index.ts` barrel file. The CLI entrypoint (`src/cli.ts`) is the only entry point.
