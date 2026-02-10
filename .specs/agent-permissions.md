# Agent Permissions

## Overview

Each agent has explicit file access permissions. These are enforced via system prompts, not technically — with `dangerouslySkipPermissions` enabled, agents could write anywhere. This is an accepted trust model for a developer tool.

## Permission Levels

| Permission | Meaning |
|------------|---------|
| **WRITE** | The agent is expected to create, edit, and delete files here |
| **READ + DELETE** | The agent can read files and delete them (e.g. to resolve an issue), but must not create new files |
| **TASK_WRITABLE** | Do NOT modify unless the current focus or plan explicitly requires it. When it does, the agent must make those changes. This includes avoiding git operations (checkout, restore, reset) that would revert uncommitted changes in these paths |
| **READ-ONLY** | The agent may read but must not modify, delete, or revert files |
| **IGNORE** | The agent must not read or write files here — these paths are off-limits |

## Permissions by Agent

| Path | PM | Planning | Implementing | Reviewing | Audit |
|------|-----|----------|--------------|-----------|-------|
| specsPath | WRITE | TASK_WRITABLE | TASK_WRITABLE | READ-ONLY | READ-ONLY |
| specIssuesPath | READ + DELETE | — | — | — | — |
| backlogPath | WRITE | — | — | — | — |
| tbdPath | READ + DELETE | — | — | — | READ-ONLY |
| memoryPath | WRITE | — | — | — | READ-ONLY |
| planPath | — | WRITE | — | — | — |
| previousPlanPath | — | READ-ONLY (if present) | — | — | — |
| reviewPath | — | READ-ONLY (if present) | — | WRITE | — |
| checkOutputPath | — | — | READ-ONLY | READ-ONLY | — |
| sessionPath | — | — | READ-ONLY | READ-ONLY | — |
| Source code | — | READ-ONLY | WRITE | READ-ONLY | READ-ONLY |
| Everything else in cugginoPath | IGNORE | IGNORE | IGNORE | IGNORE | IGNORE |

## Notes

- **PM agent** does not participate in the coding loop. It interacts directly with the user in an interactive session.
- **Audit agent** is fully read-only. It does not modify any files. Its findings are persisted to the TBD folder by the system (not by the agent itself).
- **TASK_WRITABLE on specsPath** allows the planning and implementing agents to modify specs only when the focus or plan explicitly requires it (e.g. a backlog item that says "update the spec for feature X"). By default, specs are treated as read-only by these agents.
- **IGNORE on cugginoPath** means agents must not access any files inside `.cuggino/` beyond the specific subpaths listed in their row. This prevents agents from accidentally reading or modifying backlog items, spec issues, TBD files, or other management data that is not relevant to their role.
