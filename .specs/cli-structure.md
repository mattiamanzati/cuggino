# CLI Structure

## Overview

The CLI is organized as a root command with subcommands. Command definitions are separated from layer composition and runtime bootstrap.

## Commands

### Root Command — `cuggino`

When invoked **without a subcommand**, starts PM mode (project manager) — an interactive Claude session for discussing specs, managing the backlog, and resolving issues. See [pm-command.md](./pm-command.md) for full details.

Supports a `--version` / `-v` flag.

### Subcommands

| Command | Purpose | Details |
|---------|---------|---------|
| `cuggino run` | Execute a single coding loop for a given focus | See [run-command.md](./run-command.md) |
| `cuggino watch` | Continuously process backlog items | See [watch-command.md](./watch-command.md) |
| `cuggino setup` | Interactively configure the project | See [setup-command.md](./setup-command.md) |

## Configuration

All configuration values are read from `.cuggino.json` via `StorageService.readConfig()` in each command handler. There are no CLI flag overrides — the config file is the single source of truth. See [storage.md](./storage.md) for the config schema.

## Entrypoint

The CLI entrypoint (`src/cli.ts`) is responsible for layer composition (wiring up services and platform dependencies) and running the root command via `NodeRuntime.runMain`. This project does not export a public API module.
