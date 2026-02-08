# CLI Structure

## Overview

The CLI is organized as a root command with subcommands. Command definitions are separated from layer composition and runtime bootstrap.

## Commands

### Root Command — `cuggino`

When invoked without a subcommand, displays help/usage information. Supports a `--version` / `-v` flag.

Every command that requires an LLM provider has an `--agent` / `-a` flag to select the provider (`claude` or `codex`, default `claude`). Each command handler uses its own `--agent` value to retrieve the provider layer from the `LayerMap` and compose the dependent services on top.

### Subcommands

| Command | Purpose | Details |
|---------|---------|---------|
| `cuggino pm` | Interactive project manager session (or Telegram bot with `--telegram`) | See [pm-command.md](./pm-command.md), [telegram-pm.md](./telegram-pm.md) |
| `cuggino run` | Execute a single coding loop for a given focus | See [run-command.md](./run-command.md) |
| `cuggino watch` | Continuously process backlog items | See [watch-command.md](./watch-command.md) |
| `cuggino setup` | Interactively configure the project | See [setup-command.md](./setup-command.md) |

## Configuration

Project configuration is read from `.cuggino.json` via `StorageService.readConfig()` in each command handler. See [storage.md](./storage.md) for the config schema.

The `--agent` flag is the only runtime CLI override — it selects which LLM provider layer to use. All other settings come from the config file.

## Entrypoint

The CLI entrypoint (`src/cli.ts`) is responsible for layer composition and running the root command via `NodeRuntime.runMain`. This project does not export a public API module.

A `LayerMap` service is defined with a lookup that maps agent names to their `LlmAgent` provider layers. Each command's `Command.provide` callback receives the `--agent` value, retrieves the provider layer via the `LayerMap`, and composes the dependent services on top.
