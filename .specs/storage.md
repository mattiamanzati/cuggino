# Storage

## Overview

All persistent data is stored under a `.cuggino/` folder relative to the current working directory. A `StorageService` ensures the folder structure exists and provides paths to each subfolder.

## Folder Structure

```
.cuggino.json       ← Project configuration (created by `cuggino setup`, lives in project root)

.cuggino/
  wip/            ← Active session files (temp plans, session logs, reviews)
  spec-issues/    ← Persisted spec issue reports
  backlog/        ← Focus items queued for implementation
  tbd/            ← Items to be defined (reserved for future use)
```

### `wip/`

Managed by the `SessionService`. Contains temporary files for active coding loop sessions. These files are created when a session starts and cleaned up when the session ends.

Files:
- `<uuid>.md` — Session file (plan + appended markers)
- `<uuid>.review.md` — Code review file (written by reviewing agent on `<REQUEST_CHANGES>`)
- `<uuid>.plan.md` — Temporary plan file (written by planning agent, committed to session file)

### `spec-issues/`

When the loop detects a `<SPEC_ISSUE>` marker and emits a `LoopSpecIssue` event, the spec issue content is persisted here as a file named `<uuid>.md` (a new UUIDv7 for each issue).

The `LoopSpecIssue` event includes both the spec issue text content and the filename where it was saved, so the CLI can inform the user where to find it.

### `backlog/`

Contains coarse-grained work items waiting to be implemented — milestones, features, or user stories, not fine-grained implementation tasks.

Each file should be short (a couple of lines) and point to the relevant spec files rather than containing detailed implementation instructions. The full feature description and requirements belong in the specs folder.

Files are named so that alphabetical sorting reflects the desired execution order (e.g., `001-add-auth.md`, `002-refactor-api.md`). Tasks are picked up and executed in filename order by the coding loop.

### `tbd/`

Contains "to be discussed" items — findings from the [audit agent](./audit-agent.md) that need human review. Each file is a self-contained finding describing a discrepancy, unclear spec, or improvement opportunity.

Files:
- `<uuid>.md` — A single finding (content from a `<TO_BE_DISCUSSED>` marker)

These files are created by the watch service when the audit agent emits `<TO_BE_DISCUSSED>` markers during idle time. They are intended to be reviewed and acted upon by the user via the `plan` command, similar to spec issues.

## StorageService

A regular Effect service (not parameterized — operates on the current working directory).

### Construction

On construction, the service:
1. Resolves the `.cuggino/` path relative to `cwd`
2. Ensures the root folder and all subfolders exist (creates them if missing, using `recursive: true`)

### Shape

```typescript
interface StorageServiceShape {
  /** Path to the .cuggino root directory */
  readonly rootDir: string

  /** Path to .cuggino/wip */
  readonly wipDir: string

  /** Path to .cuggino/spec-issues */
  readonly specIssuesDir: string

  /** Path to .cuggino/backlog */
  readonly backlogDir: string

  /** Path to .cuggino/tbd */
  readonly tbdDir: string

  /**
   * Write a spec issue to .cuggino/spec-issues/.
   * Generates a UUIDv7 filename, writes the content, and returns the filename.
   */
  readonly writeSpecIssue: (content: string) => Effect.Effect<string, StorageError>

  /**
   * Write a TBD item to .cuggino/tbd/.
   * Generates a UUIDv7 filename, writes the content, and returns the filename.
   */
  readonly writeTbdItem: (content: string) => Effect.Effect<string, StorageError>

  /**
   * Read and parse .cuggino.json (in the project root) using the CugginoConfig Schema.
   * Returns the parsed config with defaults applied for missing fields.
   * If the file doesn't exist or fails to parse, returns the default config (no error).
   */
  readonly readConfig: () => Effect.Effect<CugginoConfig, StorageError>

  /**
   * Write the config to .cuggino.json (in the project root).
   */
  readonly writeConfig: (config: CugginoConfig) => Effect.Effect<void, StorageError>
}
```

## CugginoConfig Schema

The config file is parsed and validated using an Effect Schema. All fields are optional with defaults:

```typescript
const CugginoConfig = Schema.Struct({
  specsPath: Schema.String.pipe(Schema.withDecodingDefaultKey(() => ".specs")),
  maxIterations: Schema.Number.pipe(Schema.withDecodingDefaultKey(() => 10)),
  checkCommand: Schema.String.pipe(Schema.withDecodingDefaultKey(() => "pnpm check && pnpm test")),
  commit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false)),
  audit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false))
})

type CugginoConfig = typeof CugginoConfig.Type
```

`withDecodingDefaultKey` makes each key optional in the JSON — if the key is missing, the default is used. This means a completely empty `{}` file (or missing file) produces a valid config with all defaults.

This schema is defined in `StorageService.ts` (or a shared types file) and used by both `StorageService` (for reading/writing) and the config provider loading logic.

## Service Responsibilities

Some folders are managed directly by other services (e.g., `SessionService` manages `wipDir`). The `StorageService` owns operations for the folders not managed by a dedicated service, such as writing spec issues.

## Impact on Existing Services

### SessionService

The `SessionService` changes to use `StorageService.wipDir` for its file paths instead of computing `.cuggino/` directly. The session files move from:

- `.cuggino/.tmp.<uuid>.md` → `.cuggino/wip/<uuid>.md`
- `.cuggino/.tmp.<uuid>.review.md` → `.cuggino/wip/<uuid>.review.md`
- `.cuggino/.tmp.<uuid>.plan.md` → `.cuggino/wip/<uuid>.plan.md`

The `.tmp.` prefix is no longer needed since files are now in a dedicated `wip/` subfolder.

The `SessionService` no longer needs to create the `.cuggino/` directory itself — `StorageService` handles that.

### LoopSpecIssue Event

The `LoopSpecIssue` event gains a `filename` field containing the name of the file where the spec issue was persisted (e.g., `01964a1b-...-.md`). The loop orchestrator writes the file to `StorageService.specIssuesDir` before emitting the event.
