# Watch Command

## Overview

The `cuggino watch` command continuously processes backlog items by running the coding loop for each one. When the backlog is empty, it watches for new items to appear. When a spec issue occurs, it waits for the user to resolve it before retrying.

## Command

```bash
# Start watching
cuggino watch
```

### Options

No CLI options. All configuration options (`specsPath`, `maxIterations`, `checkCommand`, `commit`, `audit`) are read from `.cuggino.json` via `StorageService.readConfig()` and passed to `WatchService.run()`. See [setup-command](./setup-command.md) for details.

## WatchLoopEvent

The watch service emits its own event type, `WatchLoopEvent`, to communicate watch-level state changes. These events are emitted on the watch stream alongside the inner `LoopEvent`s from each coding loop run.

### TypeId

`WatchLoopEvent` uses a `WatchLoopEventTypeId` symbol (`Symbol.for("WatchLoopEvent")`) in the class body, following the same pattern as `LoopPhaseEventTypeId`.

**Type guard:** `isWatchLoopEvent(event)` — checks `WatchLoopEventTypeId in event`

### Event Types

All events are defined as Effect Schema classes with a `_tag` field.

| Event | Fields | Description |
|-------|--------|-------------|
| `WatchBacklogEmpty` | — | Backlog folder is empty, entering watch mode on backlog folder |
| `WatchChangeDetected` | — | Filesystem change detected in a watched folder, starting debounce |
| `WatchDebounceComplete` | — | Debounce period elapsed, re-checking folder |
| `WatchProcessingItem` | `filename: string` | Picking up a backlog item for processing |
| `WatchItemCompleted` | `filename: string` | Backlog item processing finished (deleted from backlog) |
| `WatchSpecIssueWaiting` | — | Spec issue detected, entering watch mode on spec-issues folder |
| `WatchAuditStarted` | — | Audit agent spawned during idle time (only when `audit` is enabled in config) |
| `WatchAuditEnded` | — | Audit agent finished on its own (no more findings to report) |
| `WatchAuditInterrupted` | — | Audit agent was interrupted because work arrived (backlog item or spec issues resolved) |
| `WatchTbdItemFound` | `content: string`, `filename: string` | A to-be-discussed item was found and persisted to `.cuggino/tbd/` |

## Watch Stream

`WatchService.run()` returns a `Stream` instead of an `Effect<never>`:

```typescript
Stream.Stream<WatchEvent, WatchError, ...>
```

Where `WatchEvent` is:

```typescript
type WatchEvent = LoopEvent | WatchLoopEvent
```

The stream runs indefinitely (until interrupted). It interleaves:
- **WatchLoopEvents** for watch-level state transitions
- **LoopEvents** from the inner coding loop (passed through as-is)

The watch service does **not** write to stdout directly. All output is handled by the CLI output layer (see [cli-output-formatting](./cli-output-formatting.md)).

## Behavior

The watch command operates as an infinite loop with two modes: **processing** and **watching**.

### Loop Entry

At the top of each loop iteration, the watch command checks folders in this order:

1. **Check spec-issues folder first** — if any spec issue files exist, enter watching mode on the spec-issues folder (do not process backlog items while spec issues are unresolved)
2. **Check backlog folder** — if files exist, enter processing mode; if empty, enter watching mode on the backlog folder

### Processing Mode

1. List files in the backlog folder, sorted by filename
2. Pick the **first** file
3. Emit `WatchProcessingItem` with the filename
4. Pass `@${filePath}` as the **focus** for the coding loop (the `@` prefix lets the Claude CLI read the file content)
5. Compute and store a hash of the file content using `Hash.string` from Effect
6. Run the coding loop (`LoopService.run()`) — all `LoopEvent`s from the inner loop are forwarded to the watch stream
7. Handle the loop outcome (see below)

### Watching Mode

When there is nothing to process (backlog is empty, or waiting for spec issues to be resolved), the command watches the relevant folder for changes:

1. Emit the appropriate event (`WatchBacklogEmpty` or `WatchSpecIssueWaiting`)
2. If `audit` is enabled in config, spawn the audit agent in the background (see [Audit During Idle](#audit-during-idle))
3. Watch the folder for filesystem changes
4. Once a change is detected, **interrupt the audit agent** (if running), emit `WatchChangeDetected` and start a **30-second debounce timer**
5. If another change occurs within 30 seconds, reset the timer
6. After 30 seconds pass with no changes, emit `WatchDebounceComplete` and re-check the folder

## Loop Outcome Handling

| Outcome | Action |
|---------|--------|
| **Approved** | Re-read the backlog file and compare its hash to the stored hash. If unchanged, delete the file and emit `WatchItemCompleted`. If changed, keep the file (it will be re-processed in the next iteration). |
| **Max iterations reached** | Same as Approved — only delete if hash matches. |
| **Spec issue** | Do NOT delete the backlog file (regardless of hash). The spec issue is persisted to `.cuggino/spec-issues/` (this already happens in the loop). Enter watching mode on the **spec-issues folder**, waiting for it to become empty. Once empty (after 30s debounce), restart the loop picking up the first backlog item. |

### Hash-Based Deletion

When the watch loop picks a backlog file, it stores the content hash. After the coding loop completes (Approved or Max Iterations), it re-reads the file and compares hashes before deleting:

- **Hash matches**: The file was not modified during the loop. Safe to delete.
- **Hash differs**: The file was edited while the loop was running (e.g., user refined the task). Keep the file so it gets picked up and re-processed on the next iteration.
- **File no longer exists**: Someone already deleted it. No action needed.

### Spec Issue Recovery

When a spec issue occurs:

1. The loop persists the issue to `.cuggino/spec-issues/` (existing behavior)
2. The watch command emits `WatchSpecIssueWaiting` and starts watching the `spec-issues` folder
3. The user resolves the issue via the `plan` command (which updates specs and deletes the issue file)
4. Once the spec-issues folder is empty and 30 seconds have passed without changes, the watch command retries the same backlog item with a fresh loop

## Flow Diagram

```
┌─────────────────────────────────────┐
│            Watch Start              │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│    Check spec-issues folder         │◄──────────────────────┐
│                                     │                       │
│   Has files?                        │                       │
│     Yes → emit WatchSpecIssueWaiting│                       │
│            watch spec-issues folder │──► (debounce 30s) ───┘
│     No  → continue to backlog check │                       │
└─────────────────────────────────────┘                       │
                  │ (no spec issues)                           │
                  ▼                                            │
┌─────────────────────────────────────┐                       │
│       Check backlog folder          │                       │
│                                     │                       │
│   Has files?                        │                       │
│     Yes → pick first by filename    │                       │
│     No  → emit WatchBacklogEmpty    │                       │
│           watch backlog folder      │──► (debounce 30s) ───┘
└─────────────────────────────────────┘
                  │ (has file)
                  ▼
┌─────────────────────────────────────┐
│  Emit WatchProcessingItem           │
│  Read backlog file content          │
│  Run coding loop (forward events)   │
└─────────────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
   Approved /           Spec Issue
   Max Iterations            │
        │                    ▼
        ▼              Back to top
 Emit                  (spec issues will be
 WatchItemCompleted     caught at top of loop)
 Delete file                 │
        │                    │
        └────────►───────────┘
                  │
                  ▼
          Back to top (check spec-issues, then backlog)
```

## Audit During Idle

When `audit` is enabled in config, the watch command spawns an [audit agent](./audit-agent.md) during idle states (both empty backlog and spec-issue waiting).

### Behavior

1. When entering idle mode, emit `WatchAuditStarted` and spawn the audit agent via `LlmAgent.spawn()`
2. The audit agent's event stream (including `LlmAgentEvent`s and `ToBeDiscussed` markers) is forwarded to the watch output stream
3. When a `ToBeDiscussed` marker is detected:
   - Persist the content to `.cuggino/tbd/` via `StorageService.writeTbdItem()`
   - Emit `WatchTbdItemFound` with the content and filename
4. When the audit agent finishes on its own, emit `WatchAuditEnded` — the folder watcher continues alone
5. When the idle state ends (folder change detected), **interrupt the audit agent fiber** (kills the process) and emit `WatchAuditInterrupted`
6. Continue with normal processing (backlog item or spec-issue re-check)

### Concurrency

The audit agent and the folder watcher run concurrently. The implementation races between:
- The folder watch completing (change detected)
- The audit agent stream (which runs indefinitely until interrupted or the agent finishes)

When the folder watch wins the race, the audit agent fiber is interrupted and `WatchAuditInterrupted` is emitted. When the audit agent finishes on its own (ran out of things to find), `WatchAuditEnded` is emitted and the folder watch continues alone until a change is detected.

### No Persistence of Partial Findings

If the audit agent is interrupted mid-marker (e.g., it was in the middle of emitting a `<TO_BE_DISCUSSED>` tag), that partial finding is lost. Only fully emitted and parsed markers are persisted. This is acceptable — the finding will likely be rediscovered on the next audit run.

## Lifecycle

- The watch command runs indefinitely until terminated by the user (Ctrl+C)
- On shutdown, any running coding loop is interrupted gracefully
- The command uses `StorageService` to resolve backlog and spec-issues folder paths
