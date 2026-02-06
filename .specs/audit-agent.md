# Audit Agent

## Overview

The audit agent is a background agent that runs during idle time in the watch loop (when `audit` is enabled in config). Its purpose is to scan the codebase and specs, looking for discrepancies, unclear specifications, and improvement opportunities. Findings are persisted to `.cuggino/tbd/` and surfaced to the user through the watch output.

## When It Runs

The audit agent runs whenever the watch loop enters an **idle state**:

- **Backlog empty** — no items to process
- **Spec issue waiting** — waiting for the user to resolve spec issues

It is **interrupted** as soon as the idle state ends (backlog item arrives, or spec issues are resolved).

## What It Does

The audit agent:

1. Reads the specs folder to understand the project requirements
2. Navigates the codebase to understand the current implementation
3. Compares implementation against specs, looking for:
   - **Discrepancies** — code that doesn't match what the specs describe
   - **Missing implementations** — things specified but not implemented
   - **Spec gaps** — code that exists but isn't covered by any spec
   - **Unclear specs** — ambiguous or contradictory specification language
   - **Improvement opportunities** — structural or organizational improvements to specs
4. Emits findings as `TO_BE_DISCUSSED` markers (each emitted immediately as discovered, not batched)
5. Checks existing TBD files to **avoid duplicating** findings that have already been raised
6. Reads `.cuggino/memory.md` (read-only) to **avoid re-emitting** findings that the user has previously dismissed

The agent is read-only — it does not make any code changes. It runs with `dangerouslySkipPermissions: true` for uninterrupted navigation. It receives the path to `.cuggino/memory.md` so it can check for previously dismissed findings.

## Findings

Each finding is emitted as a `TO_BE_DISCUSSED` marker. This marker is:

- **Non-terminal** — the agent continues scanning after emitting it (can emit multiple per run)
- **Self-contained and actionable** — each finding describes what was expected vs. what was found
- **Focused on human decisions** — not trivial issues, but things that require judgment

When a finding is detected, it is persisted to `.cuggino/tbd/<uuid>.md` and surfaced on the watch output.

## Interruption

The audit agent runs as a background process that is interrupted when work arrives:

- The Claude CLI process is killed
- Partially written findings are discarded (only fully emitted markers are persisted)
- Findings already persisted to `.cuggino/tbd/` are kept
- Each idle period starts a fresh audit run (no resumption — the agent checks existing TBD files and the memory file to avoid duplicates and dismissed findings)
