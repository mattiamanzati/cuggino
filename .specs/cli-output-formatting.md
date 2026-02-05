# CLI Output Formatting

## Overview

This specification defines what the user sees in the terminal when running cuggino commands. All output formatting is handled by a single output layer that wraps event streams — commands do not write to stdout directly.

## Event Display

### Agent Activity

When agents are working, the user sees their activity streamed in real-time:

- **System messages** — shown dimmed, prefixed with `[System]`
- **Agent messages** — shown dimmed (the agent's reasoning and explanations)
- **Tool calls** — shown in dim cyan, with the tool name and most relevant parameter (e.g., `Read: /path/to/file.ts`, `Bash: pnpm build`, `Grep: pattern`)
- **Tool results** — shown dimmed with line numbers, truncated to avoid flooding the terminal

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
| Setup command output | Dim | `[Setup] Output: {truncated output}` |
| Check command starting | Dim | `[Check] Running...` |
| Check command output | Dim | `[Check] Output: {truncated output}` |
| Loop approved | Bold Green | `[Loop] Implementation approved!` |
| Spec issue found | Bold Red | `[Loop] Spec issue: {content}` + saved location |
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
