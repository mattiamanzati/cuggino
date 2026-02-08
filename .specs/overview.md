# Autonomous Coder Loop

## Overview

This project is a CLI application that implements an autonomous coding loop. Given a `.specs/` folder containing project specifications, the system orchestrates multiple AI agents to plan, implement, and review code changes to match the specifications.

## Core Concept

The user provides a **focus** (a specific feature or issue from the specs) via CLI, and the system autonomously:
1. Plans the necessary changes
2. Implements the changes
3. Reviews the implementation against specs
4. Iterates until the implementation matches the specs

## Agent Roles

The system uses three types of agents in a loop:

### 1. Planning Agent
- **Input**: Current codebase + specs + user-provided focus + (optional) previous plan and review file from the last iteration
- **Purpose**: Investigate the codebase and specs, then create a detailed plan
- **First run**: Receives the focus and creates the full plan from scratch
- **Subsequent runs**: Receives the previous plan + the review file. Creates a revised plan that accounts for completed work, tasks that need fixing, and remaining tasks.
- **Self-contained output**: The revised plan must be self-contained — it replaces the previous plan entirely. The plan must not reference or depend on the previous plan (e.g., "as in the previous plan..."), since the implementing agent only sees the current plan.
- **Output**: A plan file containing tasks, implementation details, and testing requirements
- **Can signal**: spec issue (exits loop) or plan complete (proceeds to implementation)

### 2. Implementing Agent
- **Input**: The plan + current codebase + check output (if check command configured)
- **Purpose**: Pick and implement **one task** from the plan
- **Behavior**:
  - Reads the plan
  - Picks **one and only one** task to implement
  - Implements that task
  - Emits `DONE` with a descriptive summary of what was done (used as the commit message)
- **No internal loop**: The implementing agent runs once per loop iteration. It does not decide whether to continue — the reviewing agent controls the loop.
- **One task only**: The implementing agent must NOT implement multiple tasks or attempt to complete the entire plan in one pass. The prompt must explicitly instruct the agent to pick a single task, implement it, emit DONE, and stop. The remaining tasks will be handled in subsequent iterations.

### 3. Reviewing Agent
- **Input**: Specs + plan + code changes + check output (if check command configured) + (optional) initial commit hash
- **Purpose**: Verify that the plan's tasks are correctly implemented, and check consistency with specs
- **Priority**: The plan is the primary check (were the tasks implemented correctly?). The specs are a secondary consistency check (does the implementation contradict the specs?).
- **When initial commit hash provided** (via `commit` config): Focuses review on changes introduced since that commit
- **When no initial commit hash** (commit disabled): The reviewer relies on the plan and the specs to evaluate what was implemented, without a git diff baseline
- **Always writes a review file**: The reviewer always produces a review file. The review describes what was done correctly, what needs fixing, and what tasks remain.
- **Outcome**:
  - **Approved** — all plan tasks are correctly implemented and consistent with specs, loop finishes
  - **Request changes** — either tasks were implemented incorrectly, or tasks from the plan remain unimplemented. The review file describes the details. Loop goes back to planning.
  - **Spec issue** — specs are unclear/inconsistent, loop exits

## Markers

Agents communicate progress and decisions by emitting markers in their output. The system parses these in real-time.

### Marker Types

| Marker | Meaning |
|--------|---------|
| `NOTE` | Observation, finding, or choice made during implementation |
| `SPEC_ISSUE` | Specs are unclear, ambiguous, or inconsistent — loop exits immediately |
| `DONE` | Implementing agent finished its one task — marker text is used as the commit message |
| `PLAN_COMPLETE` | Planning finished, ready for implementation |
| `APPROVED` | All plan tasks are correctly implemented and consistent with specs, loop can finish |
| `REQUEST_CHANGES` | Tasks were implemented incorrectly, or tasks from the plan remain — loop continues |
| `TO_BE_DISCUSSED` | Finding that needs human review (used by audit agent only) |

### Which Agents Emit Which Markers

| Marker | Planning | Implementing | Reviewing | Audit |
|--------|----------|--------------|-----------|-------|
| `NOTE` | | yes | | |
| `SPEC_ISSUE` | yes | yes | yes | |
| `PLAN_COMPLETE` | yes | | | |
| `DONE` | | yes | | |
| `APPROVED` | | | yes | |
| `REQUEST_CHANGES` | | | yes | |
| `TO_BE_DISCUSSED` | | | | yes |

### Spec Issue Handling

When any agent emits a spec issue, the loop **exits immediately**. No further agents are spawned. The system waits for human intervention to clarify or fix the specification before the loop can be restarted.

## Setup Command

After each planning phase completes, the system can optionally run a setup command to prepare the environment before implementation begins (e.g., installing dependencies, running builds).

- **Optional**: Only runs if `setupCommand` is configured in `.cuggino.json` and is non-empty
- **Announced**: A "starting" event is emitted before the command runs, so the user knows what's happening
- **Failure exits the loop**: If the setup command exits with a non-zero code, the loop emits an error and exits. Setup failures typically indicate a broken environment (e.g., failed dependency install) where continuing would be pointless.
- **Output is not passed to agents**: Unlike the check command, setup output is for environment preparation and is not forwarded to implementing or reviewing agents.
- **Runs once per planning phase**: Not repeated for each implementing agent iteration

## Check Command

Before each implementing agent iteration and before the reviewing agent, the system can optionally run a check command to verify the codebase state (linting, type checking, tests, etc.).

- **Optional**: Only runs if `checkCommand` is configured in `.cuggino.json` and is non-empty
- **Announced**: A "starting" event is emitted before the command runs, so the user knows what's happening
- **Output is passed to the agent**: The agent can use check failures to understand what needs fixing
- **Failure is non-blocking**: The loop continues — check output (including errors) is context for the agent

### When Setup and Check Run

| Phase | Setup? | Check? |
|-------|--------|--------|
| Before Planning Agent | No | No |
| After Planning Agent | Yes (if configured) | No |
| Before Implementing Agent | No | Yes (if configured) |
| Before Reviewing Agent | No | Yes (if configured) |

## Auto-Commit

When the `commit` option is enabled in `.cuggino.json`, the loop automatically commits all changed files after the implementing agent emits `DONE`. This creates a checkpoint of progress after each task.

- After the implementing agent finishes, all changes are staged and committed (excluding the specs folder and the `.cuggino/` folder)
- The `DONE` marker text is used as the commit message (the implementing agent should provide a descriptive summary, not just "implemented task #5")
- The initial HEAD commit hash is captured before the loop starts, so the reviewer can focus on changes introduced since that baseline
- If there are no changes to commit, the commit is skipped
- If the commit fails, the loop continues (the failure is reported but does not stop the loop)
- If the repository has no commits yet, capturing the initial commit hash fails gracefully (returns null), and the reviewer reviews the full codebase without a git diff baseline

## Auto-Push

When the `push` option is set in `.cuggino.json` (e.g., `"push": "origin/main"`), the loop automatically pushes to the specified remote branch after each successful auto-commit.

- **Requires `commit`**: Push only happens when `commit` is also enabled and a commit was actually created. If `commit` is disabled or there were no changes to commit, no push occurs.
- **Runs after each commit**: Every time an implementing agent produces a commit, the push follows immediately.
- **Non-fatal**: If the push fails (network error, authentication issue, remote conflicts), the failure is reported as a warning but does **not** stop the loop. The user can push manually later.
- **Value format**: The `push` value is a remote/branch reference (e.g., `origin/main`, `origin/dev`). When absent or empty, no push occurs.

## Main Loop Flow

```
                         CLI Start
                    (user provides focus)
                              |
                              v
              +------> Planning Agent  <--------------+
              |   (creates or revises the plan)       |
              |     SPEC_ISSUE --> EXIT (error)        |
              |               |                        |
              |               v                        |
              |  Run Setup Command (if configured)     |
              |               |                        |
              |               v                        |
              |  Run Check (if configured)             |
              |               |                        |
              |               v                        |
              |     Implementing Agent                 |
              |     (picks ONE task, implements it)    |
              |     SPEC_ISSUE --> EXIT (error)         |
              |               |                        |
              |          DONE --> commit                |
              |          (if enabled) then              |
              |          push (if configured)           |
              |               |                        |
              |               v                        |
              |  Run Check (if configured)             |
              |               |                        |
              |               v                        |
              |     Reviewing Agent                    |
              |     (always writes review file)        |
              |     SPEC_ISSUE --> EXIT (error)         |
              |               |                        |
              |    +----------+----------+             |
              |    |                     |             |
              | APPROVED          REQUEST_CHANGES      |
              |    |                     |             |
              |    v                     +-------------+
              | CLI Exit             (plan agent receives
              | (success)            previous plan + review)
              |
              |
   On subsequent iterations:
   Plan agent receives previous plan +
   review file, creates revised plan
```

## Configuration

Project settings are stored in `.cuggino.json`, created and updated interactively via `cuggino setup` (see [setup-command spec](./setup-command.md)). The config file is the single source of truth — there are no CLI flag overrides for configuration options. See [storage spec](./storage.md) for the config schema and folder structure.

## Sessions

Each loop run is tracked in a **session** — a file that is initialized with the plan content and then appended to as agents work, accumulating progress notes and markers. Sessions are identified by UUIDv7 and stored in `.cuggino/wip/`. Session files are automatically cleaned up when the session ends (whether approved, spec issue, or max iterations reached).

The reviewer always writes a review file alongside the session. This review describes what was implemented correctly, what needs fixing, and what tasks remain. On REQUEST_CHANGES, the plan agent receives both the previous plan and the review file to create a revised plan. The review file is cleared at the start of each reviewing phase to prevent stale review content from a previous iteration being used if the reviewer fails to write a new one.

## Technology Stack

- **Effect** for the core runtime, CLI, and service architecture (v4 / effect-smol)
- **Claude Code CLI** for agent execution (spawned as child processes)
- **pnpm** as the package manager
- **Node.js** as the runtime platform

### Agent Execution

Agents are executed by spawning `claude` CLI processes. There are two modes:

- **Streaming mode** — for the autonomous loop agents (planning, implementing, reviewing, audit). The output is parsed in real-time to detect markers and track progress. Events are formatted and displayed to the user.
- **Interactive mode** — for PM mode (the default command). The user talks to the agent directly in their terminal. No stream parsing or event system.

**Important:** All Claude CLI processes (both streaming and interactive) must be spawned using Node.js native `child_process` module, not the Effect `ChildProcess` module (which has known issues with streaming output from long-running processes). Other short-lived commands (check commands, git operations) may use the Effect `ChildProcess` module.

**Note:** Streaming mode currently relies on Claude CLI-specific flags (e.g., `--include-partial-messages` for spinner heartbeats, `--verbose` for agent activity). These are specific to the Claude CLI and may not apply to other LLM providers.

### Working Directory

Service layers (`StorageServiceLayer`, `NotificationServiceLayer`) accept a `cwd` path parameter. The CLI entry point (`cli.ts`) seeds this with `process.cwd()` — the only place in the codebase that calls `process.cwd()`. All other code receives the working directory through service layers.
