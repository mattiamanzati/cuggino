# Watch Command

## Overview

The `cuggino watch` command continuously processes backlog items by running the coding loop for each one. When the backlog is empty or spec issues are pending, it watches both folders reactively and waits for the right conditions before proceeding.

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
| `WatchSpecIssueWaiting` | — | Spec issues exist, waiting for them to be resolved |
| `WatchBacklogWaiting` | — | No spec issues but backlog is empty, waiting for backlog items |
| `WatchProcessingItem` | `filename: string` | Picking up a backlog item for processing |
| `WatchItemCompleted` | `filename: string` | Backlog item processing finished (deleted from backlog) |
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

## File Count Stream

The watching mechanism is built on a single primitive: a stream that tracks the number of files in a folder.

### `watchFileCount(folder)`

A stream that:

1. Immediately emits the current number of files in the folder
2. Watches the folder for filesystem changes
3. On each change, starts a **30-second debounce timer** (resets on further changes)
4. After debounce, re-counts files in the folder
5. Only emits if the count changed from the last emission (deduplication)

This stream runs indefinitely until interrupted.

### Combined Waiting Stream

The watch service combines two file count streams using a combinator (e.g., `zipLatest`):

- `watchFileCount(specIssuesPath)` — tracks spec issue count
- `watchFileCount(backlogPath)` — tracks backlog item count

The combined stream emits pairs of `[specIssuesCount, backlogCount]`. The watch service consumes this stream until the condition `specIssuesCount === 0 && backlogCount > 0` is met.

While consuming, the watch service emits events based on state transitions:

- When `specIssuesCount > 0`: emit `WatchSpecIssueWaiting`
- When `specIssuesCount === 0 && backlogCount === 0`: emit `WatchBacklogWaiting`

Each event is emitted only on state transition (not re-emitted when counts change within the same logical state).

## Behavior

The watch command operates as an infinite loop with two phases: **waiting** and **processing**.

### Waiting Phase

At the top of each loop iteration, the watch service enters the waiting phase using the combined file count stream:

1. Combine `watchFileCount(specIssuesPath)` and `watchFileCount(backlogPath)`
2. As counts arrive, emit the appropriate event (`WatchSpecIssueWaiting` or `WatchBacklogWaiting`) on state transitions
3. If `audit` is enabled in config, spawn the audit agent in the background while waiting (see [Audit During Idle](#audit-during-idle))
4. When the audit agent is running and the combined stream emits a change, **interrupt the audit agent**
5. Once the condition `specIssuesCount === 0 && backlogCount > 0` is met, exit the waiting phase and proceed to processing

If the condition is already satisfied on the first emission (spec issues are clear and backlog has items), the waiting phase exits immediately without emitting any waiting events.

### Processing Phase

1. List files in the backlog folder, sorted by filename
2. Pick the **first** file
3. Emit `WatchProcessingItem` with the filename
4. Pass `@${filePath}` as the **focus** for the coding loop (the `@` prefix lets the Claude CLI read the file content)
5. Compute and store a hash of the file content using `Hash.string` from Effect
6. Run the coding loop (`LoopService.run()`) — all `LoopEvent`s from the inner loop are forwarded to the watch stream
7. Handle the loop outcome (see below)

## Loop Outcome Handling

| Outcome | Action |
|---------|--------|
| **Approved** | Re-read the backlog file and compare its hash to the stored hash. If unchanged, delete the file and emit `WatchItemCompleted`. If changed, keep the file (it will be re-processed in the next iteration). |
| **Max iterations reached** | Same as Approved — only delete if hash matches. |
| **Spec issue** | Do NOT delete the backlog file (regardless of hash). The spec issue is persisted to `.cuggino/spec-issues/` (this already happens in the loop). Return to the top of the loop — the waiting phase will detect the spec issue files and emit `WatchSpecIssueWaiting`. |

### Hash-Based Deletion

When the watch loop picks a backlog file, it stores the content hash. After the coding loop completes (Approved or Max Iterations), it re-reads the file and compares hashes before deleting:

- **Hash matches**: The file was not modified during the loop. Safe to delete.
- **Hash differs**: The file was edited while the loop was running (e.g., user refined the task). Keep the file so it gets picked up and re-processed on the next iteration.
- **File no longer exists**: Someone already deleted it. No action needed.

### Spec Issue Recovery

When a spec issue occurs:

1. The loop persists the issue to `.cuggino/spec-issues/` (existing behavior)
2. The watch loop returns to the top, entering the waiting phase
3. The combined file count stream detects spec issue files and emits `WatchSpecIssueWaiting`
4. The user resolves the issue via `cuggino` (PM mode), which updates specs and deletes the issue file
5. Once the spec-issues count drops to 0 and backlog count is > 0, the waiting phase exits and processing resumes

**Important:** The backlog file is intentionally NOT deleted when a spec issue occurs. Since the watch service always picks the first file in alphabetical order, the same backlog item is naturally retried after the spec issue is resolved. This implicit coupling between "don't delete on spec issue" and "alphabetical ordering" is what makes retry work.

## Flow Diagram

```
┌─────────────────────────────────────┐
│            Watch Start              │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│         Waiting Phase               │◄──────────────────────┐
│                                     │                       │
│  Combine:                           │                       │
│    watchFileCount(specIssues)        │                       │
│    watchFileCount(backlog)           │                       │
│                                     │                       │
│  specIssues > 0?                    │                       │
│    → emit WatchSpecIssueWaiting     │                       │
│  specIssues == 0 && backlog == 0?   │                       │
│    → emit WatchBacklogWaiting       │                       │
│                                     │                       │
│  (audit agent runs in background    │                       │
│   while waiting, if enabled)        │                       │
│                                     │                       │
│  Exit when:                         │                       │
│    specIssues == 0 && backlog > 0   │                       │
└─────────────────────────────────────┘                       │
                  │                                            │
                  ▼                                            │
┌─────────────────────────────────────┐                       │
│  Emit WatchProcessingItem           │                       │
│  Read backlog file content          │                       │
│  Run coding loop (forward events)   │                       │
└─────────────────────────────────────┘                       │
                  │                                            │
        ┌─────────┴──────────┐                                │
        │                    │                                 │
   Approved /           Spec Issue                             │
   Max Iterations            │                                 │
        │                    ▼                                 │
        ▼              Back to top ────────────────────────────┘
 Emit                  (waiting phase will detect
 WatchItemCompleted     spec issues via file count stream)
 Delete file                 │
        │                    │
        └────────►───────────┘
                  │
                  ▼
          Back to top (waiting phase)
```

## Audit During Idle

When `audit` is enabled in config, the watch command spawns an [audit agent](./audit-agent.md) during the waiting phase.

### Behavior

1. When entering the waiting phase (and the condition is not immediately satisfied), emit `WatchAuditStarted` and spawn the audit agent via `LlmAgent.spawn()`
2. The audit agent's event stream (including `LlmAgentEvent`s and `ToBeDiscussed` markers) is forwarded to the watch output stream
3. When a `ToBeDiscussed` marker is detected:
   - Persist the content to `.cuggino/tbd/` via `StorageService.writeTbdItem()`
   - Emit `WatchTbdItemFound` with the content and filename
4. When the audit agent finishes on its own, emit `WatchAuditEnded` — the file count stream continues alone
5. When the waiting phase ends (condition met), **interrupt the audit agent fiber** (kills the process) and emit `WatchAuditInterrupted`
6. Continue with processing

### Concurrency

The audit agent and the file count streams run concurrently. The implementation races between:
- The combined file count stream satisfying the exit condition
- The audit agent stream (which runs indefinitely until interrupted or the agent finishes)

When the file count condition is met first, the audit agent fiber is interrupted and `WatchAuditInterrupted` is emitted. When the audit agent finishes on its own (ran out of things to find), `WatchAuditEnded` is emitted and the file count stream continues alone until the exit condition is met.

### No Persistence of Partial Findings

If the audit agent is interrupted mid-marker (e.g., it was in the middle of emitting a `<TO_BE_DISCUSSED>` tag), that partial finding is lost. Only fully emitted and parsed markers are persisted. This is acceptable — the finding will likely be rediscovered on the next audit run.

## Lifecycle

- The watch command runs indefinitely until terminated by the user (Ctrl+C)
- On shutdown, any running coding loop is interrupted gracefully
- The command uses `StorageService` to resolve backlog and spec-issues folder paths
