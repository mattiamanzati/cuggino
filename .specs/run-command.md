# Run Command

## Overview

The `cuggino run` command executes a single coding loop for a given focus. It is the primary entrypoint for the autonomous coding loop. The command reads config and passes it to `LoopService.run()`, streams the events through CLI output formatting, and exits when the loop completes.

## Command

```bash
# Run with a focus
cuggino run --focus "Implement user authentication"
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--focus` / `-f` | (required) | The focus area to work on — a specific feature or task from the specs |

All other configuration options (`specsPath`, `maxIterations`, `setupCommand`, `checkCommand`, `commit`) are read from `.cuggino.json`. See [setup-command](./setup-command.md) for details.

## Behavior

1. Read the `focus` flag value from the CLI
2. Read configuration (`specsPath`, `maxIterations`, `setupCommand`, `checkCommand`, `commit`) from `.cuggino.json` via `StorageService.readConfig()`
3. Call `LoopService.run()` with the focus, config values, and `cwd: "."`
4. Pipe the returned `Stream<LoopEvent>` through `withCliOutput` for formatting and display
5. Drain the stream (`Stream.runDrain`)
6. Exit when the stream ends (loop completed)

## Exit Behavior

The run command does not manage exit codes explicitly. The Effect returned by the command handler either succeeds or fails, and `NodeRuntime.runMain` (in `src/cli.ts`) translates that into the process exit code.

## Differences from Watch Command

| Aspect | Run | Watch |
|--------|-----|-------|
| Scope | Single loop run | Continuous loop over backlog items |
| Focus | Provided via `--focus` flag | Read from backlog files |
| Lifecycle | Exits after loop completes | Runs indefinitely |
| Backlog management | None | Picks, processes, and deletes backlog items |
