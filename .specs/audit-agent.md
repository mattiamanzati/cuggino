# Audit Agent

## Overview

The audit agent is a background agent that runs during idle time in the watch loop (when `audit` is enabled in config). Its purpose is to scan the codebase and specs, looking for discrepancies, unclear specifications, and improvement opportunities. Findings are persisted to `.cuggino/tbd/` and surfaced to the user through the watch stream.

## When It Runs

The audit agent runs whenever the watch loop enters an **idle state**:

- **Backlog empty** — no items to process
- **Spec issue waiting** — waiting for the user to resolve spec issues

It is **interrupted** as soon as the idle state ends (backlog item arrives, or spec issues folder becomes empty after debounce).

## Agent Configuration

The audit agent is spawned via `LlmAgent.spawn()` (non-interactive, streaming mode).

| Setting | Value |
|---------|-------|
| `dangerouslySkipPermissions` | `true` (read-only navigation) |
| `cwd` | Project root (same as the watch command) |
| `systemPrompt` | See below |

### System Prompt

Both the system prompt and the prompt are parameterized functions, like the other agent prompts:

```typescript
interface AuditPromptOptions {
  readonly specsPath: string
  readonly tbdPath: string
}
```

The audit agent's system prompt instructs it to:

1. Read the specs folder (`{specsPath}`) to understand the project requirements
2. Navigate the codebase to understand the current implementation
3. Compare implementation against specs, looking for:
   - **Discrepancies** — code that doesn't match what the specs describe
   - **Missing implementations** — things specified but not implemented
   - **Spec gaps** — code that exists but isn't covered by any spec
   - **Unclear specs** — ambiguous or contradictory specification language
   - **Improvement opportunities** — structural or organizational improvements to specs
4. Emit `<TO_BE_DISCUSSED>` for each finding
5. Read existing `{tbdPath}` files to **avoid duplicating** findings that have already been raised

The prompt should emphasize:
- Be thorough but not noisy — only raise genuinely useful findings
- Each `<TO_BE_DISCUSSED>` should be self-contained and actionable
- Emit each `<TO_BE_DISCUSSED>` as soon as it is found — do not batch findings or wait until the end
- Focus on things that require human decision-making, not trivial issues
- Do NOT make any code changes — this agent is read-only

### Prompt

The prompt for the audit agent is:

```
Audit the codebase against the specs in "{specsPath}". Look for discrepancies, unclear specifications, missing implementations, and improvement opportunities. Emit <TO_BE_DISCUSSED> immediately as each finding is discovered — do not wait or batch them. Check "{tbdPath}" first to avoid duplicate findings.
```

## Output Stream

The audit agent is spawned via `LlmAgent.spawn()`, which returns a `Stream<LlmAgentEvent, LlmSessionError>`. This stream — including `AgentMessage`, `ToolCall`, `ToolResult`, `PingEvent`, and extracted markers — is **forwarded in its entirety** to the watch output stream. This means the user sees the audit agent's activity in their terminal (tool calls, reasoning, findings) just like they would see a coding loop agent's output.

The watch service treats the audit agent's stream the same way it treats a coding loop's `LoopEvent` stream: events flow through `withCliOutput` and are formatted and displayed to the user. The only special handling is for `ToBeDiscussed` marker events, which trigger persistence to `.cuggino/tbd/` (see below).

## `<TO_BE_DISCUSSED>` Marker

A new marker type used exclusively by the audit agent.

### Format

```
<TO_BE_DISCUSSED>
Description of the finding, what was expected vs. what was found,
and what decision needs to be made...
</TO_BE_DISCUSSED>
```

### Properties

- **Non-terminal** — the agent continues scanning after emitting this marker (can emit multiple per run)
- **Not in `LlmTerminalMarkerEventTypeId`** — does not stop the agent
- **Marker event class**: `ToBeDiscussed` (added to `LlmMarkerEvent` union)

### Marker Availability

| Marker Tag | Planning | Implementing | Reviewing | Audit |
|------------|----------|--------------|-----------|-------|
| `<TO_BE_DISCUSSED>` | | | | ✓ |

### Persistence

When the watch service receives a `ToBeDiscussed` marker event from the audit agent's stream:

1. Persist the content to `.cuggino/tbd/<uuid>.md` via `StorageService.writeTbdItem()`
2. Emit a `WatchTbdItemFound` event (with `content` and `filename`) on the watch stream

This follows the same pattern as `<SPEC_ISSUE>` → `LoopSpecIssue` (marker detected, then orchestrator persists and emits a richer event).

## Interruption

The audit agent runs as an Effect fiber that is **interrupted** when the idle state ends. This means:

- The Claude CLI process is killed (SIGTERM)
- Any in-progress work is discarded (partially written markers are lost — this is fine)
- Findings already persisted to `.cuggino/tbd/` are kept
- The next time idle state is entered, a fresh audit agent is spawned

The agent does NOT resume from where it left off. Each idle period starts a fresh audit run. This is acceptable because:
- The agent checks existing `.cuggino/tbd/` files to avoid duplicates
- Each run may discover new findings based on recent code changes
