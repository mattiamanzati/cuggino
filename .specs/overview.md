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
- **Input**: Current codebase + specs + user-provided focus + (optional) code review from a previous iteration
- **Purpose**: Investigate the codebase and specs, then create a detailed plan
- **When code review provided**: Creates a new plan that satisfies both the review feedback and the specs
- **Output**: A plan file containing tasks, implementation details, and testing requirements
- **Can signal**: spec issue (exits loop) or plan complete (proceeds to implementation)

### 2. Implementing Agent
- **Input**: The plan + current codebase + check output (if check command configured)
- **Purpose**: Pick and implement **one task** from the plan
- **Behavior**:
  - Reads the plan and checks previous progress in the session
  - Picks **one and only one** task to implement
  - Implements that task
  - Signals completion: either progress (more tasks remain) or done (all tasks complete)
- **Loop**: If more tasks remain, a new implementing agent is spawned for the next task. When all tasks are done, the loop proceeds to review.

### 3. Reviewing Agent
- **Input**: Specs + session (plan + notes) + code changes + check output (if check command configured) + (optional) initial commit hash
- **Purpose**: Verify implementation matches **specs** (read-only, no code changes)
- **Important**: The specs are the source of truth, not the plan. The plan is just a subset of tasks derived from specs.
- **When initial commit hash provided** (via `commit` config): Focuses review on changes introduced since that commit
- **Outcome**:
  - **Approved** — changes match specs, loop finishes
  - **Request changes** — writes a code review describing what doesn't match, loop goes back to planning
  - **Spec issue** — specs are unclear/inconsistent, loop exits

## Markers

Agents communicate progress and decisions by emitting markers in their output. The system parses these in real-time.

### Marker Types

| Marker | Meaning |
|--------|---------|
| `NOTE` | Observation, finding, or choice made during implementation |
| `SPEC_ISSUE` | Specs are unclear, ambiguous, or inconsistent — loop exits immediately |
| `PROGRESS` | Current task completed, more tasks remain |
| `DONE` | All tasks in the plan have been implemented |
| `PLAN_COMPLETE` | Planning finished, ready for implementation |
| `APPROVED` | Implementation matches specs, loop can finish |
| `REQUEST_CHANGES` | Implementation doesn't match specs, needs re-planning |
| `TO_BE_DISCUSSED` | Finding that needs human review (used by audit agent only) |

### Which Agents Emit Which Markers

| Marker | Planning | Implementing | Reviewing | Audit |
|--------|----------|--------------|-----------|-------|
| `NOTE` | | yes | | |
| `SPEC_ISSUE` | yes | yes | yes | |
| `PLAN_COMPLETE` | yes | | | |
| `PROGRESS` | | yes | | |
| `DONE` | | yes | | |
| `APPROVED` | | | yes | |
| `REQUEST_CHANGES` | | | yes | |
| `TO_BE_DISCUSSED` | | | | yes |

### Spec Issue Handling

When any agent emits a spec issue, the loop **exits immediately**. No further agents are spawned. The system waits for human intervention to clarify or fix the specification before the loop can be restarted.

## Setup Command

After each planning phase completes, the system can optionally run a setup command to prepare the environment before implementation begins (e.g., installing dependencies, running builds).

- **Optional**: Only runs if `setupCommand` is configured in `.cuggino.json`
- **Announced**: A "starting" event is emitted before the command runs, so the user knows what's happening
- **Failure is non-blocking**: The loop continues to implementation regardless of setup outcome
- **Runs once per planning phase**: Not repeated for each implementing agent iteration

## Check Command

Before each implementing agent iteration and before the reviewing agent, the system can optionally run a check command to verify the codebase state (linting, type checking, tests, etc.).

- **Optional**: Only runs if `checkCommand` is configured in `.cuggino.json`
- **Announced**: A "starting" event is emitted before the command runs, so the user knows what's happening
- **Output is passed to the agent**: The agent can use check failures to understand what needs fixing
- **Failure is non-blocking**: The loop continues — check output (including errors) is context for the agent

### When Setup and Check Run

| Phase | Setup? | Check? |
|-------|--------|--------|
| Before Planning Agent | No | No |
| After Planning Agent | Yes (if configured) | No |
| Before each Implementing Agent iteration | No | Yes (if configured) |
| Before Reviewing Agent | No | Yes (if configured) |

## Auto-Commit

When the `commit` option is enabled in `.cuggino.json`, the loop automatically commits all changed files after each implementing agent invocation. This creates a checkpoint of progress after each task.

- After each implementing agent finishes, all changes are staged and committed (excluding the specs folder)
- The marker content (progress note or done summary) is used as the commit message
- The initial HEAD commit hash is captured before the loop starts, so the reviewer can focus on changes introduced since that baseline
- If there are no changes to commit, the commit is skipped
- If the commit fails, the loop continues (the failure is reported but does not stop the loop)
- If the repository has no commits yet, the reviewer falls back to reviewing the full codebase

## Main Loop Flow

```
                         CLI Start
                    (user provides focus)
                              |
                              v
                      Planning Agent
         (reads codebase + specs, creates plan)
           SPEC_ISSUE --> EXIT (error)
                              |
                              v
               Run Setup Command (if configured)
                              |
                              v
                   Implementation Loop
                 +---------------------------+
                 |  Run Check (if configured) |
                 |            |               |
                 |            v               |
                 |  Implementing Agent        |
                 |  (executes one task)       |
                 |  SPEC_ISSUE --> EXIT       |
                 |            |               |
                 |     PROGRESS --> commit    |
                 |     (if enabled) then      |
                 |     spawn next agent       |
                 |            |               |
                 |     DONE --> commit         |
                 |     (if enabled) then      |
                 |     exit loop              |
                 +---------------------------+
                              |
                              v
                 Run Check (if configured)
                              |
                              v
                     Reviewing Agent
       (verifies implementation matches specs)
           SPEC_ISSUE --> EXIT (error)
                              |
               +--------------+--------------+
               |                             |
          APPROVED                   REQUEST_CHANGES
               |                             |
               v                             v
          CLI Exit                  Writes code review
          (success)                 (what doesn't match)
                                             |
                                             v
                                  Back to Planning Agent
                                  (with code review as input)
```

## Configuration

Project settings are stored in `.cuggino.json`, created and updated interactively via `cuggino setup` (see [setup-command spec](./setup-command.md)). The config file is the single source of truth — there are no CLI flag overrides for configuration options. See [storage spec](./storage.md) for the config schema and folder structure.

## Sessions

Each loop run is tracked in a **session** — an append-only file that starts with the plan and accumulates progress notes and markers as agents work. Sessions are identified by UUIDv7 and stored in `.cuggino/wip/`. Session files are automatically cleaned up when the session ends (whether approved, spec issue, or max iterations reached).

A separate review file may be created alongside the session when the reviewer requests changes — this is fed back to the planning agent on the next iteration.

## Technology Stack

- **Effect** for the core runtime, CLI, and service architecture (v4 / effect-smol)
- **Claude Code CLI** for agent execution (spawned as child processes)
- **pnpm** as the package manager
- **Node.js** as the runtime platform

### Agent Execution

Agents are executed by spawning `claude` CLI processes. There are two modes:

- **Streaming mode** — for the autonomous loop agents (planning, implementing, reviewing, audit). The output is parsed in real-time to detect markers and track progress. Events are formatted and displayed to the user.
- **Interactive mode** — for PM mode (the default command). The user talks to the agent directly in their terminal. No stream parsing or event system.

**Important:** The Claude CLI process must be spawned using Node.js native `child_process` module, not the Effect `ChildProcess` module (which has known issues with streaming output from long-running processes). Other short-lived commands (check commands, git operations) may use the Effect `ChildProcess` module.
