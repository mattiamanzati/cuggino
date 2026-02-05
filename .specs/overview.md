# Autonomous Coder Loop

## Overview

This project is a CLI application that implements an autonomous coding loop. Given a `.specs/` folder containing project specifications, the system orchestrates multiple AI agents to plan, implement, and review code changes to match the specifications.

## Core Concept

The user provides a **focus** (a specific feature or issue from the specs) via CLI, and the system autonomously:
1. Plans the necessary changes
2. Implements the changes
3. Reviews the implementation against specs
4. Iterates until the implementation matches the specs

## Agent Architecture

The system uses three types of agents in a loop:

### 1. Planning Agent
- **Input**: Current codebase + specs + user-provided focus + (optional) code review
- **Purpose**: Investigate the codebase and specs, then create a detailed plan
- **Code review source**: Can be from the reviewing agent (automated) or from a human (manual review)
- **When code review provided**: Creates a new plan that satisfies both the review feedback and the specs
- **Output**: A markdown file containing:
  - Tasks to implement
  - Implementation details
  - Testing requirements
- **Can emit**:
  - `<SPEC_ISSUE>` if specs are unclear/inconsistent (exits loop)
  - `<PLAN_COMPLETE>` when planning is finished (proceeds to implementation)

### 2. Implementing Agent
- **Input**: The plan + current codebase + check output (if check command configured)
- **Purpose**: Pick and implement **one task** from the plan
- **Behavior**:
  - Reads the plan and checks previous progress in the session file
  - Picks **one and only one** task to implement
  - Implements that task
  - Emits **markers** to signal:
    - `<NOTE>` - observations, findings, choices made during implementation
    - `<SPEC_ISSUE>` - unclear or inconsistent specifications
    - `<PROGRESS>` - the picked task is complete, leaves notes for future agents about remaining work
    - `<DONE>` - all tasks in the plan are complete
  - Exits after emitting `<PROGRESS>` or `<DONE>`
- **Loop**:
  - If `<PROGRESS>` → spawns another implementing agent to pick the next task
  - If `<DONE>` → proceeds to reviewing agent

### 3. Reviewing Agent
- **Input**: Specs + session file (contains plan + notes) + code changes + check output (if check command configured) + path to code review file + (optional) initial commit hash
- **Purpose**: Verify implementation matches **specs** (read-only, no code changes)
- **When initial commit hash provided** (via `commit` config): The reviewer is instructed to focus on changes introduced since that commit, using `git diff <initial-hash>..HEAD` to understand the scope of changes
- **Important**: The specs are the source of truth, not the plan. The plan is just a subset of tasks derived from specs.
- **Can emit**:
  - `<SPEC_ISSUE>` - specs are unclear/inconsistent (exits loop immediately)
  - `<APPROVED>` - changes are correct according to specs (loop finishes, CLI exits)
  - `<REQUEST_CHANGES>` - implementation doesn't match specs
- **On request changes**: Writes a code review to the provided file path describing what doesn't match the specs and what needs to change.
- **Output**:
  - If `<APPROVED>` → loop finishes, CLI exits
  - If `<REQUEST_CHANGES>` → code review written, loop back to planning agent


## Marker System

Agents emit markers using XML-style tags in their output stream. The system parses these in real-time.

### Marker Format

```
<NOTE>
Description of what was discovered or decided during implementation...
</NOTE>

<SPEC_ISSUE>
The spec says X but doesn't clarify Y...
</SPEC_ISSUE>

<PROGRESS>
Completed task X. Note for next agent: beware of Y...
</PROGRESS>

<DONE>
All tasks in the plan have been implemented.
</DONE>

<PLAN_COMPLETE>
Planning is complete, ready to implement.
</PLAN_COMPLETE>

<APPROVED>
Implementation matches the specs correctly.
</APPROVED>

<REQUEST_CHANGES>
The implementation doesn't match specs because...
</REQUEST_CHANGES>

<TO_BE_DISCUSSED>
The spec says X but the code does Y, and it's unclear which is correct...
</TO_BE_DISCUSSED>
```

### Marker Types

| Marker Tag | Purpose |
|------------|---------|
| `<NOTE>` | General observations, findings, and choices made by the agent |
| `<SPEC_ISSUE>` | Signal unclear, ambiguous, or inconsistent specifications |
| `<PROGRESS>` | Current task completed, more tasks remain in the plan |
| `<DONE>` | All tasks in the plan have been implemented |
| `<PLAN_COMPLETE>` | Planning finished, plan is ready for implementation |
| `<APPROVED>` | Implementation matches specs, loop can finish |
| `<REQUEST_CHANGES>` | Implementation doesn't match specs, new plan written |
| `<TO_BE_DISCUSSED>` | Finding that needs human review (discrepancy, unclear spec, improvement) |

### Marker Availability

| Marker Tag | Planning | Implementing | Reviewing | Audit |
|------------|----------|--------------|-----------|-------|
| `<NOTE>` | | ✓ | | |
| `<SPEC_ISSUE>` | ✓ | ✓ | ✓ | |
| `<PLAN_COMPLETE>` | ✓ | | | |
| `<PROGRESS>` | | ✓ | | |
| `<DONE>` | | ✓ | | |
| `<APPROVED>` | | | ✓ | |
| `<REQUEST_CHANGES>` | | | ✓ | |
| `<TO_BE_DISCUSSED>` | | | | ✓ |

### Spec Issue Handling

When any agent emits `<SPEC_ISSUE>`, the loop **exits immediately**. No further agents are spawned. The system waits for human intervention to clarify or fix the specification before the loop can be restarted.

## Setup Command

After each planning phase completes, the system can optionally run a setup command to prepare the environment before implementation begins (e.g., installing dependencies, running builds, database migrations).

### Default Behavior

- **Optional**: Setup only runs if `setupCommand` is configured in `.cuggino.json`
- **No default**: If `setupCommand` is not set, the setup phase is skipped entirely
- **Customizable**: Users can set `setupCommand` in `.cuggino.json` via `cuggino setup`

### Setup Output Handling

When a setup command is configured:

- The setup command's stdout and stderr are captured
- A `SetupCommandOutput` event is emitted with the captured output (for CLI display)
- **Setup failure does NOT stop the loop** — the loop continues to the implementation phase regardless
- The setup output is NOT passed to agents as context (unlike check output, which is diagnostic)

When no setup command is configured:

- The setup phase is skipped — no process is spawned, no `SetupCommandOutput` event is emitted

### When Setup Runs

| Phase | Setup Runs? |
|-------|-------------|
| After Planning Agent (first run) | Only if `setupCommand` is configured |
| After Planning Agent (re-plan from review) | Only if `setupCommand` is configured |
| Before Implementing Agent iterations | No (setup runs once after planning, not before each iteration) |
| Before Reviewing Agent | No |

## Check Command

Before each implementing agent iteration and before the reviewing agent, the system can optionally run a check command to verify the codebase state (linting, type checking, tests, etc.).

### Default Behavior

- **Optional**: Check only runs if `checkCommand` is configured in `.cuggino.json`
- **No default**: If `checkCommand` is not set, the check phase is skipped entirely
- **Customizable**: Users can set `checkCommand` in `.cuggino.json` via `cuggino setup`

### Check Output Handling

When a check command is configured:

- The check command's stdout and stderr are captured
- Output is passed to the agent (implementing or reviewing) as context
- **Check failure does NOT stop the loop** - the output (including errors) is passed to the agent
- The agent can use check failures to understand what needs fixing

When no check command is configured:

- The check phase is skipped — no process is spawned
- Agents receive no check output (the `CheckCommandOutput` event is not emitted)

### When Check Runs

| Phase | Check Runs? |
|-------|-------------|
| Before Planning Agent | No |
| Before each Implementing Agent iteration | Only if `checkCommand` is configured |
| Before Reviewing Agent | Only if `checkCommand` is configured |

### CLI Usage

```bash
# Run with focus (check command configured in .cuggino.json)
cuggino run --focus "Add feature X"
```

The `setupCommand`, `checkCommand`, and `commit` options are configured in `.cuggino.json` via `cuggino setup`.

## Auto-Commit

When the `commit` option is enabled in `.cuggino.json`, the loop automatically commits all changed files after each implementing agent invocation. This creates a checkpoint of progress after each task.

### Behavior

After each implementing agent finishes (emitting `<PROGRESS>` or `<DONE>`):

1. Run `git add -A` to stage all changes (new, modified, deleted) **excluding the configured specs folder** (e.g., `git add -A -- . ':!.specs'` using git pathspec exclude syntax)
2. Run `git commit` with the content of the `<PROGRESS>` or `<DONE>` marker as the commit message
3. Emit a `CommitPerformed` loop phase event

The commit happens immediately after the implementing agent, before the loop continues (next implementing agent iteration, or review phase).

### Initial Commit Capture

When `commit` is enabled in config, the loop captures the current HEAD commit hash **before any changes are made** (at the very start of the loop, before the first planning agent). This hash is stored and later passed to the reviewing agent so it can focus its review on the changes introduced since that baseline.

If the repository has no commits yet, the initial hash is `null` and the reviewer falls back to its default behavior (reviewing the full codebase).

### Edge Cases

- If there are no changes to commit (no staged changes after `git add -A`), skip the commit and do not emit `CommitPerformed`
- If the git commit fails for any reason, the loop continues — the commit failure does not stop the loop. A `CommitFailed` event is emitted instead.

### Configuration

The `commit` option is configured in `.cuggino.json` and applies to both `run` and `watch` commands:

```json
{
  "commit": true
}
```

## Main Loop Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Start                                │
│                    (user provides focus)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Planning Agent                              │
│         (reads codebase + specs, creates plan)                   │
│                                                                  │
│   <SPEC_ISSUE> ──────────────────────────────────► EXIT (error)  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Run Setup Command (if configured)                  │
│              (install deps, build, etc.)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Implementation Loop                            │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Run Check Command                          │  │
│  │              (capture output for agent)                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Implementing Agent                            │  │
│  │    (executes tasks, receives check output)                 │  │
│  │                                                            │  │
│  │   <SPEC_ISSUE> ────────────────────────────► EXIT (error)  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              │                               │                   │
│         <PROGRESS>                        <DONE>                 │
│              │                               │                   │
│              ▼                               ▼                   │
│         (if commit enabled: git add -A && git commit)            │
│              │                               │                   │
│              ▼                               ▼                   │
│      spawn new agent                    exit loop                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Run Check Command                             │
│                 (capture output for agent)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Reviewing Agent                              │
│   (verifies implementation, receives check output)               │
│                                                                  │
│   <SPEC_ISSUE> ──────────────────────────────────► EXIT (error)  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
         <APPROVED>                   <REQUEST_CHANGES>
              │                               │
              ▼                               ▼
┌─────────────────────┐         ┌─────────────────────────────────┐
│     CLI Exit        │         │   Writes code review            │
│     (success)       │         │   (what doesn't match specs)    │
└─────────────────────┘         └─────────────────────────────────┘
                                              │
                                              ▼
                                    back to Planning Agent
                                    (with code review as input)
```

## Configuration

Project settings are stored in `.cuggino.json`, created and updated interactively via `cuggino setup` (see [setup-command spec](./setup-command.md)).

The config file is parsed with Effect Schema. Configuration values (`specsPath`, `maxIterations`, `setupCommand`, `checkCommand`, `commit`, `audit`) are read directly from the file via `StorageService.readConfig()` in each command handler. There are no CLI flags for these options — the config file is the single source of truth.

## Storage

All persistent data is stored under `.cuggino/` relative to the current working directory. See [storage spec](./storage.md) for the full folder structure and `StorageService` details.

## Session Files

Each session is identified by a **UUIDv7**, which provides:
- Time-ordered sorting (UUIDv7 embeds a timestamp)
- Uniqueness without coordination
- URL-safe format

Session files live in `.cuggino/wip/`.

### Session File (`.cuggino/wip/<uuid>.md`)

A simple append-only file:
- Starts with the plan at the top
- After the plan, a `# Progress Log` heading separates plan content from runtime markers
- Markers are appended to the end as they are emitted

```markdown
# Plan

## Tasks
- [ ] Task 1 description
- [ ] Task 2 description
- ...

## Implementation Details
...

# Progress Log

<NOTE>
Something discovered during implementation...
</NOTE>

<PROGRESS>
Completed task 1. Note: the utility function was placed in src/utils.ts.
</PROGRESS>

<NOTE>
Another observation...
</NOTE>

<DONE>
All tasks implemented.
</DONE>
```

### Review File (`.cuggino/wip/<uuid>.review.md`)

A separate file created by the reviewing agent when emitting `<REQUEST_CHANGES>`. Contains the code review describing what doesn't match the specs.

This file is then fed to the planning agent on the next iteration.

### File Creation Flow

1. **Planning phase**: Planning agent writes plan to a temporary file (`.cuggino/wip/<uuid>.plan.md`)
2. **After planning exits**: System moves content to `.cuggino/wip/<uuid>.md`
3. **Implementation phase**: Markers appended to end of session file
4. **Review phase**: If `<REQUEST_CHANGES>`, review written to `.cuggino/wip/<uuid>.review.md`

### Session Cleanup

Session files are **deleted upon session completion**. This includes:
- The session file (`.cuggino/wip/<uuid>.md`)
- The review file (`.cuggino/wip/<uuid>.review.md`) if it exists
- The temporary plan file (`.cuggino/wip/<uuid>.plan.md`)

Session files are only useful during the active loop. Once the session ends (whether by `<APPROVED>`, `<SPEC_ISSUE>`, or max iterations reached), the files are cleaned up automatically.

## Technology Stack

- **Effect CLI** for command-line interface
- **Effect** for the core runtime and service architecture
- **Claude Code CLI** for agent execution (spawned as child processes)

### Effect v4 Dependencies

This project uses Effect v4 (effect-smol). All platform modules are now consolidated into the `effect` package, with platform-specific implementations in separate packages.

**Package manager:** pnpm

**Required packages:**
```
effect                  - Core Effect library (includes CLI, ChildProcess, etc.)
@effect/platform-node   - Node.js platform implementation
```

**Installation (from PR builds):**
```bash
pnpm add https://pkg.pr.new/Effect-TS/effect-smol/effect@6a720b2
pnpm add https://pkg.pr.new/Effect-TS/effect-smol/@effect/platform-node@6a720b2
```

**Import paths:**
- `effect` - Core types, Effect, Stream, Schema, etc.
- `effect/unstable` - Unstable APIs like ChildProcess, CLI
- `@effect/platform-node` - Node.js services layer

## Agent Execution

Agents are executed by spawning `claude` CLI processes. Each agent type receives a specific system prompt and the relevant context (specs, plan, codebase access).

**Important:** The **Claude CLI process** must be spawned using **Node.js native `child_process` module** (e.g., `child_process.spawn`), not the Effect `ChildProcess` module from `effect/unstable`. The Effect `ChildProcess` module has known issues with streaming output from long-running processes. The native Node.js spawn is wrapped in Effect for integration with the rest of the system, but the actual process management uses Node directly.

**Other short-lived commands** (check commands, git operations, etc.) may use the Effect `ChildProcess` module from `effect/unstable`. The native `child_process` requirement only applies to the Claude CLI, which is a long-running streaming process.

### LlmAgent Service

The `LlmAgent` service exposes two methods:

- **`spawn`** — Non-interactive, streaming mode. Returns a stream of parsed events. Used by the autonomous coding loop (planning, implementing, reviewing agents).
- **`interactive`** — Interactive mode. Inherits stdio so the user talks directly to the agent in the terminal. Returns the process exit code. Used by the `plan` command.

### LlmAgentSpawnOptions

Options passed to the `LlmAgent.spawn()` method:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Current working directory for the agent |
| `prompt` | `string` | Yes | The prompt to send to the agent |
| `systemPrompt` | `string` | No | Appended system prompt (`--append-system-prompt`) |
| `dangerouslySkipPermissions` | `boolean` | No | Skip permission checks (`--dangerously-skip-permissions`) |
| `sessionId` | `string` | No | Start a new session with this ID (`--session-id <value>`) |
| `resumeSessionId` | `string` | No | Resume an existing session by ID (`--resume <value>`) |

The output stream from Claude Code is parsed in real-time to:
- Detect markers emitted by the agent
- Track progress and task completion
- Capture findings and decisions for later review

### LlmAgentInteractiveOptions

Options passed to the `LlmAgent.interactive()` method:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Current working directory for the agent |
| `systemPrompt` | `string` | No | Appended system prompt (`--append-system-prompt`) |
| `dangerouslySkipPermissions` | `boolean` | No | Skip permission checks (`--dangerously-skip-permissions`) |

The interactive method spawns the agent process with inherited stdio (`stdin`, `stdout`, `stderr` connected to the user's terminal). There is no stream parsing, no event system — the user interacts with the agent directly. The method returns `Effect.Effect<number, LlmSessionError>` where the success value is the process exit code.

### LlmAgentEvent Stream

The agent's output is represented as an Effect `Stream` of events (only for `spawn`, not `interactive`):

```typescript
Stream.Stream<LlmAgentEvent, LlmSessionError>
```

**Event Types:**

| Event | Description |
|-------|-------------|
| `SystemMessage` | System initialization or status message |
| `AgentMessage` | Text output from the LLM agent |
| `ToolCall` | Agent requesting to execute a tool |
| `ToolResult` | Result from tool execution |
| `PingEvent` | Activity heartbeat - indicates the agent is still working |

**Error Handling:**

- When the Claude process completes successfully, the stream simply ends
- When the Claude process encounters an error, the stream fails with `LlmSessionError`
- Errors are in the stream's error channel, not as events in the success channel

### Marker Extraction

When markers are detected in the agent's text output, the marker extraction layer:
1. Parses the marker tags from the `AgentMessage` text
2. Emits the corresponding marker event (e.g., `Note`, `Done`, `Approved`)
3. Removes the marker text from the `AgentMessage` to avoid duplicate display

This means the CLI will not print the raw marker tags - only the formatted marker display.

### Event Category System

All events use **TypeId symbols** in the class body to identify their category. This allows code to check event categories without enumerating all `_tag` values.

**Category symbols:**

| Symbol | Applied to |
|--------|-----------|
| `LlmAgentEventTypeId` | All `LlmAgentEvent` classes |
| `LlmMarkerEventTypeId` | All `LlmMarkerEvent` classes |
| `LlmTerminalMarkerEventTypeId` | Terminal markers only (`SpecIssue`, `PlanComplete`, `Progress`, `Done`, `Approved`, `RequestChanges`) — `ToBeDiscussed` is NOT terminal |
| `LoopPhaseEventTypeId` | All `LoopPhaseEvent` classes |
| `LoopTerminalEventTypeId` | Terminal loop events only (`LoopApproved`, `LoopSpecIssue`, `LoopMaxIterations`) |
| `WatchLoopEventTypeId` | All `WatchLoopEvent` classes |

**Type guards:**
- `isLlmAgentEvent(event)` — checks `LlmAgentEventTypeId in event`
- `isLlmMarkerEvent(event)` — checks `LlmMarkerEventTypeId in event`
- `isLlmTerminalMarkerEvent(event)` — checks `LlmTerminalMarkerEventTypeId in event`
- `isLoopPhaseEvent(event)` — checks `LoopPhaseEventTypeId in event`
- `isLoopTerminalEvent(event)` — checks `LoopTerminalEventTypeId in event`
- `isWatchLoopEvent(event)` — checks `WatchLoopEventTypeId in event`

### Loop Stream

The `LoopService.run()` returns a `Stream` of events:

```typescript
Stream.Stream<LoopEvent, LoopError | SessionError>
```

Where `LoopEvent` is the union of all event types:

```typescript
type LoopEvent = LlmAgentEvent | LlmMarkerEvent | LoopPhaseEvent
```

**Loop phase events** (all defined as Effect Schema classes with an `iteration` field):

| Event | Description |
|-------|-------------|
| `IterationStart` | New iteration beginning (includes `maxIterations`) |
| `PlanningStart` | Planning phase starting |
| `ImplementingStart` | Implementation phase starting |
| `ReviewingStart` | Review phase starting |
| `SetupCommandOutput` | Setup command output captured (only when `setupCommand` configured) |
| `CheckCommandOutput` | Check command output captured (only when `checkCommand` configured) |
| `LoopApproved` | Implementation approved (terminal) |
| `LoopSpecIssue` | Spec issue found (terminal). Includes `content` and `filename` (persisted to `.cuggino/spec-issues/`) |
| `LoopMaxIterations` | Max iterations reached (terminal) |
| `CommitPerformed` | Auto-commit succeeded (only when `commit` enabled in config). Includes `commitHash` and `message`. |
| `CommitFailed` | Auto-commit failed (only when `commit` enabled in config). Includes `message` (error details). |

The stream **ends immediately** after emitting a terminal `LoopPhaseEvent`.

### PrintableEvent

The CLI output layer operates on `PrintableEvent`, which is a union of all event types that can be formatted:

```typescript
type PrintableEvent = LoopEvent | WatchLoopEvent
```

This allows the same formatting pipeline to handle both coding loop events and watch service events.

### CLI Output

The `withCliOutput` stream combinator wraps any `PrintableEvent` stream to add CLI formatting as a side effect:
- Accepts `Stream<PrintableEvent>` (or any subtype, e.g. `Stream<LoopEvent>`)
- Manages spinner state internally
- Formats and prints each event to stdout using the appropriate formatter
- Passes all events through unchanged
- Optional — can be omitted in tests for pure event assertions

### Watch Stream

The `WatchService.run()` returns a `Stream` of `WatchEvent`:

```typescript
type WatchEvent = LoopEvent | WatchLoopEvent
```

The stream runs indefinitely, interleaving `WatchLoopEvent`s (watch-level state transitions) with `LoopEvent`s (forwarded from inner coding loop runs). The watch service does not write to stdout directly — all output is handled by wrapping the stream with `withCliOutput` at the CLI entrypoint. See [watch-command spec](./watch-command.md) for details.
