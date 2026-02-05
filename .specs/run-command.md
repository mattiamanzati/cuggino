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
| `--focus` / `-f` | (required) | The focus area to work on — a specific feature or task from the specs |

All other configuration options (`specsPath`, `maxIterations`, `setupCommand`, `checkCommand`, `commit`) are read from `.cuggino.json`. See [setup-command](./setup-command.md) for details.

## Behavior

1. Read the `focus` flag value
2. Read configuration from `.cuggino.json`
3. Run the coding loop with the given focus
4. Display events as they occur (see [cli-output-formatting](./cli-output-formatting.md))
5. Exit when the loop completes

## Exit Behavior

The command exits when the loop finishes — whether by approval, spec issue, or max iterations. The process exit code reflects whether the loop succeeded or failed.

## Differences from Watch Command

| Aspect | Run | Watch |
|--------|-----|-------|
| Scope | Single loop run | Continuous loop over backlog items |
| Focus | Provided via `--focus` flag | Read from backlog files |
| Lifecycle | Exits after loop completes | Runs indefinitely |
| Backlog management | None | Picks, processes, and deletes backlog items |
