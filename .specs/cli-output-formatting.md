# CLI Output Formatting

## Overview

This specification defines what the user sees in the terminal when running cuggino commands. The CLI output module is the **sole module** allowed to write to `process.stdout`. All other modules (loop, watch service, agents, etc.) communicate by emitting events on their streams — they never write to stdout directly. The CLI output layer subscribes to these event streams and handles all terminal rendering.

The exception is the `setup` command, which is an interactive prompt flow and writes its configuration summary directly to stdout.

## Verbose Flag

The `run` and `watch` commands accept a `--verbose` flag (default: `false`). Note: `--verbose` intentionally has no `-v` short alias because the root command uses `-v` for `--version`. This flag is passed to the output formatting layer and controls the level of detail shown.

When **verbose is off** (default), the following are hidden:
- System messages
- Agent messages (reasoning and explanations)
- Tool results (file contents, command output)
- Setup command output → replaced with `[Setup] Completed (exit {code})` or `[Setup] Failed (exit {code})`
- Check command output → replaced with `[Check] Completed (exit {code})` or `[Check] Failed (exit {code})`

When **verbose is on**, everything is shown (the current behavior).

The following are always shown regardless of verbose mode: tool calls, markers, loop phase events, watch events, commit events, and the activity spinner.

## Event Display

### Agent Activity

When agents are working, the user sees their activity streamed in real-time (some items are verbose-only, see above):

- **System messages** — shown dimmed, prefixed with `[System]` *(verbose only)*
- **Agent messages** — shown dimmed (the agent's reasoning and explanations) *(verbose only)*
- **Tool calls** — shown in dim cyan, prefixed with `▶`, with the tool name and most relevant parameter (e.g., `▶ Read: /path/to/file.ts`, `▶ Bash: pnpm build`, `▶ Grep: pattern`)
- **Tool results** — shown dimmed with line numbers, truncated to avoid flooding the terminal *(verbose only)*

### Markers

When agents emit markers, they are displayed prominently with color coding:

| Marker | Color | Format |
|--------|-------|--------|
| `NOTE` | Bold Yellow | `[NOTE] {content}` |
| `SPEC_ISSUE` | Bold Red | `[SPEC_ISSUE] {content}` |
| `PROGRESS` | Bold Blue | `[PROGRESS] {content}` |
| `DONE` | Bold Green | `[DONE] {content}` |
| `APPROVED` | Bold Green | `[APPROVED] {content}` |
| `REQUEST_CHANGES` | Bold Yellow | `[REQUEST_CHANGES] {content}` |
| `PLAN_COMPLETE` | Bold Green | `[PLAN_COMPLETE] {content}` |
| `TO_BE_DISCUSSED` | Bold Magenta | `[TO_BE_DISCUSSED] {content}` |

Markers are visually separated from surrounding output with empty lines. The raw marker tags are not shown — only the formatted display.

### Loop Phase Events

The loop emits events at phase transitions, displayed as:

| Event | Color | Format |
|-------|-------|--------|
| Iteration start | Bold | `[Loop] === Iteration {n}/{max} ===` |
| Planning start | Dim | `[Planning] Starting...` |
| Implementing start | Dim | `[Implementing] Starting...` |
| Reviewing start | Dim | `[Reviewing] Starting...` |
| Setup command starting | Dim | `[Setup] Running...` |
| Setup command output (verbose) | Dim | `[Setup] Output:` followed by output on the next line |
| Setup command output (non-verbose) | Dim | `[Setup] Completed (exit {code})` or `[Setup] Failed (exit {code})` |
| Check command starting | Dim | `[Check] Running...` |
| Check command output (verbose) | Dim | `[Check] Output:` followed by output on the next line |
| Check command output (non-verbose) | Dim | `[Check] Completed (exit {code})` or `[Check] Failed (exit {code})` |
| Loop approved | Bold Green | `[Loop] Implementation approved!` |
| Spec issue found | Bold Red | `[Loop] Spec issue: {content}` followed by `Saved to: {filename}` on the next line (unstyled) |
| Max iterations | Bold Yellow | `[Loop] Max iterations ({max}) reached` |
| Commit succeeded | Bold Magenta | `[Commit] {hash}: {message}` |
| Commit failed | Bold Red | `[Commit] Failed: {message}` |

### Watch Events

When running `cuggino watch`, additional events are displayed:

| Event | Color | Format |
|-------|-------|--------|
| Spec issue waiting | Dim | `[Watch] Spec issue detected, waiting for resolution...` |
| Backlog empty | Dim | `[Watch] Backlog empty, waiting for new items...` (with terminal bell) |
| Processing item | Dim | `[Watch] Processing: {filename}` |
| Item completed | Dim | `[Watch] Completed: {filename}` |
| Item retained | Dim | `[Watch] Retained: {filename} (content changed during loop)` |
| Audit started | Cyan | `[Watch] Starting audit agent...` |
| Audit ended | Cyan | `[Watch] Audit agent finished.` |
| Audit interrupted | Cyan | `[Watch] Audit agent interrupted, work arrived.` |
| TBD item found | Bold Magenta | `[Watch] TBD item found: {filename}` |

The backlog-empty event triggers a terminal bell (`\x07`) to notify the user that the watch loop is idle.

## Activity Spinner

When the agent is working but no visible events are being produced, an animated spinner is shown:

```
⠹ Working... (12s)
```

- Uses braille dot pattern characters for smooth animation
- Shows elapsed time since the last visible event
- Elapsed time is omitted if less than 1 second
- The spinner is overwritten in-place (no scrolling) and cleared when real output arrives

## Output Examples

```
[Loop] === Iteration 1/10 ===
[Planning] Starting...
⠹ Working... (5s)
▶ Read: /path/to/file.ts
  1→import { Effect } from "effect"
  2→...
  (showing 2 of 150 lines)

[PLAN_COMPLETE] Plan ready with 3 tasks.

[Setup] Running...
[Setup] Output: (truncated)
[Implementing] Starting...
[Check] Running...
[Check] Output: (truncated)
▶ Bash: pnpm build
▶ Write: /src/feature.ts

[PROGRESS] Completed task 1 — added authentication module.

[Commit] a1b2c3d: Completed task 1 — added authentication module.

[Implementing] Starting...
...

[DONE] All tasks from the plan have been implemented.

[Reviewing] Starting...

[APPROVED] Implementation matches the specifications.

[Loop] Implementation approved!
```
