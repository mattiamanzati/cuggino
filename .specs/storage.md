# Storage

## Overview

All persistent data is stored under a `.cuggino/` folder relative to the current working directory. A `StorageService` ensures the folder structure exists and provides access to each subfolder.

## Folder Structure

```
.cuggino.json       <- Project configuration (created by `cuggino setup`, lives in project root)

.cuggino/
  wip/            <- Active session files (temp plans, session logs, reviews)
  spec-issues/    <- Persisted spec issue reports
  backlog/        <- Focus items queued for implementation
  tbd/            <- To-be-discussed items from the audit agent
  memory.md       <- PM memory: dismissed findings and user decisions
```

### `wip/`

Contains temporary files for active coding loop sessions. These files are created when a session starts and cleaned up when the session ends. Managed by the `SessionService`.

Files:
- `<uuid>.md` — Session file (plan + appended markers)
- `<uuid>.review.md` — Code review file (written by reviewing agent on request changes)
- `<uuid>.plan.md` — Temporary plan file (written by planning agent, moved to session file)

### `spec-issues/`

When the loop detects a spec issue marker, the content is persisted here as `<uuid>.md`. The user is informed where to find it, and it blocks the watch loop until resolved.

### `backlog/`

Contains coarse-grained work items waiting to be implemented — milestones, features, or user stories, not fine-grained implementation tasks.

Each file should be short and point to the relevant spec files rather than containing detailed implementation instructions. Files are named so that alphabetical sorting reflects the desired execution order (e.g., `001-add-auth.md`, `002-refactor-api.md`). Tasks are picked up and executed in filename order by the watch loop.

### `tbd/`

Contains "to be discussed" items — findings from the [audit agent](./audit-agent.md) that need human review. Each file (`<uuid>.md`) is a self-contained finding describing a discrepancy, unclear spec, or improvement opportunity. These are reviewed by the user via `cuggino` (PM mode).

### `memory.md`

A single markdown file (`.cuggino/memory.md`) maintained by the PM agent. It records decisions and dismissed findings from TBD triage sessions — for example, when the user reviews a TBD item and decides to skip it, the PM records a summary of the dismissed finding here.

This file serves as persistent memory across PM sessions and audit runs:
- The **PM agent** reads and writes this file to track dismissed findings and user decisions
- The **audit agent** reads this file (read-only) to avoid re-emitting findings the user has already dismissed

## CugginoConfig Schema

The config file is parsed and validated using an Effect Schema. Most fields are optional with defaults; `setupCommand` and `checkCommand` are truly optional (absent or empty string means "skip"):

```typescript
const CugginoConfig = Schema.Struct({
  specsPath: Schema.String.pipe(Schema.withDecodingDefaultKey(() => ".specs")),
  maxIterations: Schema.Number.pipe(Schema.withDecodingDefaultKey(() => 10)),
  setupCommand: Schema.optionalKey(Schema.String),
  checkCommand: Schema.optionalKey(Schema.String),
  commit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false)),
  audit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false)),
  notify: Schema.Union(Schema.Literal("none"), Schema.Literal("osx-notification")).pipe(Schema.withDecodingDefaultKey(() => "none" as const))
})

type CugginoConfig = typeof CugginoConfig.Type
```

A completely empty `{}` file (or missing file) produces a valid config with defaults for most fields and `undefined` for `setupCommand`/`checkCommand`.

An empty string `""` for `setupCommand` or `checkCommand` is treated the same as absent — the corresponding phase is skipped.
