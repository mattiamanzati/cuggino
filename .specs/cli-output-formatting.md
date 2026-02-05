# CLI Output Formatting

## Overview

This specification defines how the CLI should format and display output to provide a visually appealing and informative experience.

## PrintableEvent

The CLI output layer operates on `PrintableEvent`, a union of all event types that can be formatted for display:

```typescript
type PrintableEvent = LoopEvent | WatchLoopEvent
```

Where:
- `LoopEvent = LlmAgentEvent | LlmMarkerEvent | LoopPhaseEvent` — events from the coding loop
- `WatchLoopEvent` — events from the watch service (see [watch-command](./watch-command.md))

The `formatCliOutput` and `withCliOutput` stream combinators accept `Stream<PrintableEvent>` (or any subtype thereof).

## Formatter Functions

The formatting logic is split into **separate pure functions** for each event category. Each function takes an event and returns a formatted string (or `null` if nothing should be printed). The `PingEvent` is excluded from formatters — it is handled entirely by the spinner.

### `formatLlmAgentEvent(event: LlmAgentEvent): string | null`

Formats raw agent events. Returns `null` for `PingEvent` (handled by spinner).

| Event | Color | Format |
|-------|-------|--------|
| `SystemMessage` | Dim | `[System] {text}` |
| `AgentMessage` | Dim | `{text}` |
| `UserMessage` | Dim | `[User] {text}` |
| `ToolCall` | Dim Cyan (`\x1b[2;36m`) | `▶ {name}: {parameter summary}` |
| `ToolResult` | Dim | Line-numbered output (truncated) |
| `PingEvent` | — | Returns `null` (spinner handles this) |

**Tool parameter formatting:** Extract the most relevant parameter based on tool name:

| Tool | Parameter shown |
|------|----------------|
| `Bash` | `command` |
| `Read` / `Write` / `Edit` | `file_path` |
| `Glob` / `Grep` | `pattern` |
| `WebFetch` | `url` |
| `Task` | `description` or `prompt` |
| Other | First string value found |

**Tool result formatting:** Show line-numbered output, truncated to a max number of lines:
```
  1→import { Effect } from "effect"
  2→...
  (showing 2 of 150 lines)
```

### `formatLlmMarkerEvent(event: LlmMarkerEvent): string`

Formats extracted marker events. Always returns a string (markers are always displayed).

| Marker | Color | Format |
|--------|-------|--------|
| `Note` | Bold Yellow (`\x1b[1;33m`) | `[NOTE] {content}` |
| `SpecIssue` | Bold Red (`\x1b[1;31m`) | `[SPEC_ISSUE] {content}` |
| `Progress` | Bold Blue (`\x1b[1;34m`) | `[PROGRESS] {content}` |
| `Done` | Bold Green (`\x1b[1;32m`) | `[DONE] {content}` |
| `Approved` | Bold Green (`\x1b[1;32m`) | `[APPROVED] {content}` |
| `RequestChanges` | Bold Yellow (`\x1b[1;33m`) | `[REQUEST_CHANGES] {content}` |
| `PlanComplete` | Bold Green (`\x1b[1;32m`) | `[PLAN_COMPLETE] {content}` |
| `ToBeDiscussed` | Bold Magenta (`\x1b[1;35m`) | `[TO_BE_DISCUSSED] {content}` |

Marker output is wrapped with empty lines for visual separation:
```
\n[DONE] All tasks from the plan have been implemented.\n
```

### `formatLoopPhaseEvent(event: LoopPhaseEvent): string`

Formats loop orchestration events. All events are rendered here — there is no separate final result display.

| Event | Color | Format |
|-------|-------|--------|
| `IterationStart` | Bold | `[Loop] === Iteration {n}/{max} ===` |
| `PlanningStart` | Dim | `[Planning] Starting...` |
| `ImplementingStart` | Dim | `[Implementing] Starting...` |
| `ReviewingStart` | Dim | `[Reviewing] Starting...` |
| `CheckCommandOutput` | Dim | `[Check] Output:\n{truncated output}` |
| `LoopApproved` | Bold Green | `[Loop] Implementation approved!` |
| `LoopSpecIssue` | Bold Red | `[Loop] Spec issue: {content}\nSaved to: {filename}` |
| `LoopMaxIterations` | Bold Yellow | `[Loop] Max iterations ({max}) reached` |
| `CommitPerformed` | Bold Magenta | `[Commit] {commitHash}: {message}` |
| `CommitFailed` | Bold Red | `[Commit] Failed: {message}` |

### `formatWatchLoopEvent(event: WatchLoopEvent): string`

Formats watch service events. Most events are rendered with a `[Watch]` prefix in dim style. Audit lifecycle events use cyan, and `WatchTbdItemFound` uses bold magenta.

| Event | Color | Format |
|-------|-------|--------|
| `WatchBacklogEmpty` | Dim | `[Watch] Backlog empty, watching for new items...` + terminal bell (`\x07`) |
| `WatchChangeDetected` | Dim | `[Watch] Change detected, debouncing...` |
| `WatchDebounceComplete` | Dim | `[Watch] Debounce complete, checking folder...` |
| `WatchProcessingItem` | Dim | `[Watch] Processing: {filename}` |
| `WatchItemCompleted` | Dim | `[Watch] Completed: {filename}` |
| `WatchSpecIssueWaiting` | Dim | `[Watch] Spec issue detected, waiting for resolution...` |
| `WatchAuditStarted` | Cyan (`\x1b[36m`) | `[Watch] Starting audit agent...` |
| `WatchAuditEnded` | Cyan (`\x1b[36m`) | `[Watch] Audit agent finished.` |
| `WatchAuditInterrupted` | Cyan (`\x1b[36m`) | `[Watch] Audit agent interrupted, work arrived.` |
| `WatchTbdItemFound` | Bold Magenta | `[Watch] TBD item found: {filename}` |

## Activity Spinner

The `PingEvent` is the only event **not** handled by the formatter functions. It is handled entirely by the spinner, which is managed by the `withCliOutput` stream combinator.

### Spinner Characters

Use braille dot pattern for smooth animation:
```
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
```

### Behavior

1. **On PingEvent**:
   - If last output was a spinner line, clear it
   - Print new spinner frame with elapsed time
   - Format: `⠹ Working... (12s)`

2. **On any real event** (anything except PingEvent):
   - If last output was a spinner line, clear it
   - Call the appropriate formatter function for the event
   - Print the formatted output
   - Reset elapsed time counter

3. **Elapsed time**:
   - Track time since last "real" event (not ping)
   - Display in seconds: `(5s)`, `(12s)`, `(1m 30s)`
   - If elapsed < 1s, omit the time: `⠋ Working...`

### Implementation Details

**Key principle:** The spinner line is printed WITHOUT a trailing newline. This allows it to be overwritten in place using carriage return.

```
State to track:
- lastOutputWasSpinner: boolean
- lastRealEventTime: DateTime
- currentSpinnerIndex: number (0-9)

On PingEvent:
  1. Calculate elapsed = abs(now - lastRealEventTime)
  2. Print: \x1b[2K\r (clear line, carriage return to start)
  3. Print: {spinnerChar} Working... ({elapsed})  [NO trailing newline]
     - If elapsed < 1s, omit the time: {spinnerChar} Working...
  4. Set lastOutputWasSpinner = true
  5. Increment spinnerIndex (mod 10)

On real event:
  1. If lastOutputWasSpinner:
     - Print: \x1b[2K\r (clear line, carriage return)
  2. Format event using the appropriate formatter function
  3. Print formatted output [WITH trailing newline]
  4. Set lastOutputWasSpinner = false
  5. Set lastRealEventTime = now
```

### Event Dispatch

The `computeEventOutput` function dispatches events to the correct formatter using type guards:

1. `PingEvent` — handled by spinner (special case)
2. `isWatchLoopEvent(event)` — dispatched to `formatWatchLoopEvent`
3. `isLoopPhaseEvent(event)` — dispatched to `formatLoopPhaseEvent`
4. `isLlmMarkerEvent(event)` — dispatched to `formatLlmMarkerEvent`
5. Otherwise — dispatched to `formatLlmAgentEvent`

## Output Format Examples

### Tool Call
```
▶ Read: /path/to/file.ts
```

### Tool Result (truncated)
```
  1→import { Effect } from "effect"
  2→...
  (showing 2 of 150 lines)
```

### Agent Message
```
I'll analyze the codebase structure...
```

### Markers
```
[NOTE] Found existing implementation in src/utils.ts

[DONE] All tasks from the plan have been implemented.

[APPROVED] Implementation matches the specifications.
```

### Spinner
```
⠹ Working... (5s)
```

### Loop Phase Events
```
[Loop] === Iteration 1/10 ===
[Planning] Starting...
[Implementing] Starting...
[Check] Output: (truncated)
```

### Commit Events (when `commit` enabled in config)
```
[Commit] a1b2c3d: Completed task 1 — added user authentication module.

[Commit] Failed: git commit exited with code 1
```

### Watch Events
```
[Watch] Backlog empty, watching for new items...
[Watch] Starting audit agent...
[Watch] Processing: 001-add-auth.md
[Watch] Completed: 001-add-auth.md
[Watch] Spec issue detected, waiting for resolution...
```

### Audit Findings
```
[TO_BE_DISCUSSED] The spec describes a retry mechanism in overview.md but no retry logic exists in the codebase...

[Watch] TBD item found: 019c3a1b-...-.md
```

## Terminal Bell

The `WatchBacklogEmpty` event appends the terminal bell character (`\x07`) to its formatted output. This causes the terminal to play a notification sound (or flash, depending on the user's terminal settings) when the watch loop becomes idle after clearing all backlog items. The bell is part of the formatted string — no separate mechanism is needed.

## ANSI Escape Codes Reference

| Code | Effect |
|------|--------|
| `\x1b[0m` | Reset all |
| `\x1b[1m` | Bold |
| `\x1b[2m` | Dim |
| `\x1b[31m` | Red |
| `\x1b[32m` | Green |
| `\x1b[33m` | Yellow |
| `\x1b[34m` | Blue |
| `\x1b[35m` | Magenta |
| `\x1b[36m` | Cyan |
| `\x1b[2;36m` | Dim Cyan |
| `\x1b[2K` | Clear entire line |
| `\r` | Carriage return (move cursor to start of line) |

**Note:** The spinner uses `\x1b[2K\r` (clear line + carriage return) to overwrite in place, avoiding the need for cursor movement commands like `\x1b[1A`.

**Note:** Combined codes (e.g., `\x1b[1;33m`) and separate codes (e.g., `\x1b[1m\x1b[33m`) are interchangeable. Both forms are acceptable in the implementation.
