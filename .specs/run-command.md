# Run Command

## Overview

The `cuggino run` command executes a single coding loop for a given focus. It is the primary entrypoint for the autonomous coding loop.

## Command

```bash
cuggino run --focus "Implement user authentication"
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--agent` / `-a` | `claude` | LLM provider to use (`claude` or `codex`). See [cli-structure](./cli-structure.md). |
| `--focus` / `-f` | (required) | The focus area to work on — a text description or a file reference via `@path` (e.g., `@backlog/001-task.md`). The `@path` syntax is resolved by the underlying LLM CLI (e.g., Claude CLI), not by cuggino itself. |
| `--slow` | `false` | Run the loop in slow mode (plan → implement → review each iteration). See [overview](./overview.md) for details. |
| `--verbose` | `false` | Enable verbose output (see [cli-output-formatting](./cli-output-formatting.md)) |

All other configuration options (`specsPath`, `maxIterations`, `setupCommand`, `checkCommand`, `commit`, `push`) are read from `.cuggino.json`. The `audit` and `notify` options are watch-mode-only and are not used by the run command. See [setup-command](./setup-command.md) for details.

## Behavior

1. Read the `focus` flag value
2. Read configuration from `.cuggino.json`
3. Run the coding loop with the given focus
4. Display events as they occur (see [cli-output-formatting](./cli-output-formatting.md))
5. Exit when the loop completes

## Exit Behavior

The command exits when the loop finishes — whether by approval, spec issue, or max iterations.

| Loop outcome | Exit code |
|---|---|
| **Approved** | `0` |
| **Spec issue** | `1` |
| **Max iterations reached** | `1` |

## Differences from Watch Command

| Aspect | Run | Watch |
|--------|-----|-------|
| Scope | Single loop run | Continuous loop over backlog items |
| Focus | Provided via `--focus` flag | Read from backlog files |
| Lifecycle | Exits after loop completes | Runs indefinitely |
| Backlog management | None | Picks, processes, and deletes backlog items |
