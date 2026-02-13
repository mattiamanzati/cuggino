# Watch Command

## Overview

The `cuggino watch` command continuously processes backlog items by running the coding loop for each one. When the backlog is empty or spec issues are pending, it waits and watches for changes before proceeding.

## Command

```bash
cuggino watch
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--agent` / `-a` | `claude` | LLM provider to use (`claude` or `codex`). See [cli-structure](./cli-structure.md). |
| `--slow` | `false` | Run the loop in slow mode (plan → implement → review each iteration). See [overview](./overview.md) for details. |
| `--verbose` | `false` | Enable verbose output (see [cli-output-formatting](./cli-output-formatting.md)) |

All configuration is read from `.cuggino.json` via `StorageService.readConfig()`. See [setup-command](./setup-command.md) for details.

## Behavior

The watch command operates as an infinite loop with two phases: **waiting** and **processing**.

### Waiting Phase

At the top of each loop iteration, the watch service checks whether it can proceed:

- **Spec issues exist** — waits for them to be resolved (emits "spec issue waiting" once)
- **Backlog empty and no spec issues** — waits for backlog items to arrive (emits "backlog empty" once)
- **Backlog has items and no spec issues** — proceeds to processing immediately

The watch service monitors both the spec-issues and backlog folders reactively for filesystem changes. When files are added or removed, the service re-evaluates the condition after a 30-second debounce period (to avoid reacting to partial writes). Events are emitted only on state transitions — not repeated when file counts change within the same logical state.

If `audit` is enabled in config, the [audit agent](./audit-agent.md) runs in the background during the waiting phase. See [Audit During Idle](#audit-during-idle).

### Processing Phase

1. List files in the backlog folder, sorted by filename
2. Pick the **first** file (alphabetical order determines priority)
3. Emit a "processing item" event
4. Run the coding loop with a file reference (`@{filePath}`) to the backlog file as the focus
5. Handle the loop outcome (see below)

## Loop Outcome Handling

| Outcome | Action |
|---------|--------|
| **Approved** | Delete the backlog file (if unchanged during the loop) and emit "item completed". If the file content changed during the loop, emit "item retained" instead and keep the file for re-processing. Return to waiting phase. |
| **Max iterations reached** | Same as approved — delete the file if unchanged, or emit "item retained" if changed. |
| **Spec issue** | Do NOT delete the backlog file. The spec issue is persisted to `.cuggino/spec-issues/`. Return to waiting phase — the watcher will detect the spec issue files and wait for resolution. |

### Safe Deletion

When the watch loop picks a backlog file, it remembers the file content. After the coding loop completes, it re-reads the file and compares:

- **Content unchanged** — safe to delete (the task was processed as-is)
- **Content changed** — keep the file (someone edited the task while the loop was running; it will be re-processed next iteration)
- **File no longer exists** — no action needed (someone already deleted it)

### Spec Issue Recovery

When a spec issue occurs:

1. The loop persists the issue to `.cuggino/spec-issues/`
2. The watch loop returns to the waiting phase
3. The watcher detects spec issue files and emits "spec issue waiting"
4. The user resolves the issue via `cuggino` (PM mode), which updates specs and deletes the issue file
5. Once spec issues are cleared and backlog has items, processing resumes

The backlog file is intentionally kept when a spec issue occurs. Since the watch service always picks the first file alphabetically, the same item is naturally retried after the issue is resolved.

## Flow Diagram

```
              Watch Start
                  |
                  v
          Waiting Phase  <---------------------+
                                                |
   spec issues > 0?                             |
     --> wait for resolution                    |
   spec issues == 0 && backlog == 0?            |
     --> wait for backlog items                 |
   (audit runs in background if enabled)        |
                                                |
   Exit when: no spec issues && backlog > 0     |
                  |                             |
                  v                             |
          Processing Phase                      |
   Pick first backlog file                      |
   Run coding loop (forward events)             |
                  |                             |
        +---------+----------+                  |
        |                    |                  |
   Approved /           Spec Issue              |
   Max Iterations            |                  |
        |                    v                  |
        v              Back to top -------------+
   Delete file         (watcher detects
   (if unchanged)       spec issue files)
        |
        v
   Back to top (waiting phase)
```

## Audit During Idle

When `audit` is enabled in config, the watch command spawns an [audit agent](./audit-agent.md) in the background while in the waiting phase.

- The audit agent spawn is delayed by a short period (e.g., 1 second) so that if work arrives immediately after entering the waiting phase, the agent is never started
- The audit agent's activity (tool calls, reasoning, findings) is displayed in the terminal alongside the waiting events
- When the audit agent discovers a finding, it is persisted to `.cuggino/tbd/` and a "TBD item found" event is emitted
- When the waiting phase ends (work arrives), the audit agent is **interrupted** — any in-progress work is discarded, but findings already persisted are kept
- When the audit agent finishes on its own (no more findings), the waiting phase continues watching for file changes
- Each idle period starts a fresh audit run (no resumption from previous runs)

## System Notifications

When `notify` is set to a notification method other than `none` in config, the watch command sends notifications when entering an idle state. This lets the user switch away from the terminal and be alerted when attention is needed.

### Notification Methods

| Value | Description |
|-------|-------------|
| `none` | No notifications (default) |
| `osx-notification` | macOS notification via `terminal-notifier` with sound and best-effort click-to-focus |

### `osx-notification`

Uses [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) to send native macOS notifications. The tool must be installed on the system (e.g., `brew install terminal-notifier`). If `terminal-notifier` is not found, the notification is silently skipped (no error, no crash).

#### Triggers

| State | Title | Body |
|-------|-------|------|
| Backlog empty | `{repo-name}` | Work is complete, waiting for you |
| Spec issue waiting | `{repo-name}` | A spec issue needs to be resolved before continuing |

Where `{repo-name}` is the Git repository name (e.g., `cuggino`), detected from the working directory at startup. If the project is not a Git repository, the folder name is used instead.

#### Sound

The notification plays a sound (`-sound default`) to alert the user, even if they are not looking at the screen.

#### Click Behavior (Best-Effort)

Clicking the notification attempts to bring the relevant application to the foreground. The `-execute` flag runs an AppleScript that finds any open application with a window title containing the repo name and activates it — bringing it to the front even if it's behind other windows. The simpler `-activate` approach does not work reliably with all editors (e.g., Cursor).

This may not work in all environments. If clicking does nothing or focuses the wrong window, the sound and notification text still serve their purpose as an alert.

#### Grouping

Notifications use a group ID derived from the working directory via `-group` (e.g., `cuggino:/Users/me/projects/myapp`) so that each new notification replaces the previous one for the same project. This prevents notification stacking while keeping notifications from different projects independent.

#### Persistence

The notification is sent without specifying banner vs. alert style — the OS determines display behavior based on the user's notification preferences.

### Relationship to Terminal Bell

The terminal bell fires on both backlog-empty and spec-issue-waiting events — any idle state that needs user attention triggers a bell. The bell is independent of the `notify` setting and always active. When `notify` is set, both the bell and the notification fire.

## Lifecycle

- The watch command runs indefinitely until terminated by the user (Ctrl+C)
- On shutdown, any running coding loop or audit agent is interrupted gracefully
