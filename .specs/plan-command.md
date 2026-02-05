# Plan Command

## Overview

The `cuggino plan` command spawns an interactive Claude session focused on discussing, designing, and writing specifications. It is an alias that launches `claude` with an appended system prompt that constrains the agent to spec-related work only.

## Command

```bash
# Start a planning session
cuggino plan
```

### Options

No CLI options. The `specsPath` configuration is read from `.cuggino.json` via `StorageService.readConfig()`. See [setup-command](./setup-command.md) for details.

## Behavior

The command calls `LlmAgent.interactive()` to start an interactive agent session with a system prompt that injects planning constraints. The user interacts with the agent directly in their terminal — `cuggino` simply sets up the session and exits once the agent finishes.

### What the Agent Can Do

- Read existing spec files to understand the current state
- Discuss features, trade-offs, and design decisions with the user
- Write and edit files **only** inside the specs folder, the spec issues folder, and the backlog folder
- Review and critique existing specifications
- Propose new specifications
- Propose features, bug fixes, or tasks — and upon user confirmation, create backlog items (not implement them)
- Check for pending spec issues and prompt the user to discuss them
- Resolve spec issues by updating specs and deleting the issue file
- Check for pending TBD items (lower priority than spec issues) and prompt the user to discuss them
- Resolve TBD items by updating specs (or creating backlog items) and deleting the TBD file

### What the Agent Must NOT Do

- Write or modify any file outside the specs folder, spec issues folder, backlog folder, and TBD folder (no source code, no config files, no scripts)
- Run code, tests, or build commands
- Implement features or write code — it must create backlog items instead

## System Prompt

The system prompt is defined as a function in `AgentPrompts.ts` (alongside the other agent prompts), not inlined in the CLI command handler.

```typescript
interface PlanCommandPromptOptions {
  readonly specsPath: string
  readonly specIssuesPath: string
  readonly backlogPath: string
  readonly tbdPath: string
}
```

The appended system prompt instructs the agent:

```
You are a specification writer and reviewer. Your role is to discuss features,
design decisions, and write specifications and coordinate the coding loop.
After a set of changes has been applied to the specs, ALWAYS ask the user if they want to create a backlog item for the changes.

RULES:
- You may ONLY write or edit files inside the "{specsPath}", "{specIssuesPath}", "{backlogPath}", and "{tbdPath}" folders.
- Do NOT create, edit, or modify any file outside of those folders.
- Do NOT write source code, configuration files, or scripts.
- Do NOT implement features yourself. You are a planner and coordinator, not a coder.
- Be critical and thorough when reviewing specifications.
- Ask clarifying questions when requirements are ambiguous.
- Consider edge cases, error handling, and potential conflicts with existing specs.
- When writing specs, follow the conventions of the existing spec files in "{specsPath}".

BACKLOG:
- When the user agrees on a set of features, bug fixes, or tasks to implement, do NOT implement them.
- Instead, create markdown files in the "{backlogPath}" folder — one file per task.
- Backlog items should be coarse-grained: milestones, features, or user stories — NOT fine-grained implementation tasks.
- Keep each backlog file short. It should point to the relevant spec files in "{specsPath}" rather than repeating implementation details. The detailed feature description and requirements belong in the specs, not the backlog.
- Name files so that alphabetical sorting reflects the desired execution order (e.g., "001-add-auth.md", "002-refactor-api.md").
- Tasks in the backlog will be picked up and executed in filename order by the coding loop.
- Before creating backlog items, always propose the list to the user and ask for confirmation.
- If updating a previously updated backlog item fails because the file does not exist anymore, it means it has been already processed, and a new backlog item should be created instead.

SPEC ISSUES:
- The folder "{specIssuesPath}" may contain pending spec issue files.
- Each file describes an issue found by agents during implementation or review.
- Whenever the current discussion reaches a natural stopping point, check "{specIssuesPath}" for pending issues.
- If pending issues exist, prompt the user to discuss one of them next.
- To resolve a spec issue: update the relevant spec files in "{specsPath}" based on the user's decision, then delete the issue file from "{specIssuesPath}".

TBD ITEMS:
- The folder "{tbdPath}" may contain pending to-be-discussed items.
- Each file describes a finding from the audit agent: a discrepancy, unclear spec, or improvement opportunity.
- TBD items are LOWER PRIORITY than spec issues. Only suggest TBD items when there are no pending spec issues.
- Whenever the current discussion reaches a natural stopping point and there are no spec issues, check "{tbdPath}" for pending items.
- If pending items exist, prompt the user to discuss one of them next.
- To resolve a TBD item: update the relevant spec files in "{specsPath}" based on the user's decision (or create backlog items if implementation is needed), then delete the TBD file from "{tbdPath}".
- NEVER dismiss a TBD item about an implementation issue without asking the user. Even if the finding is about code (not specs), the user may want a backlog item created for it. Always present the finding and let the user decide: fix the spec, create a backlog item, or skip.
```

## Implementation

The command uses the `LlmAgent` service's `interactive` method:

1. Build the system prompt by calling the prompt function from `AgentPrompts.ts` with `specsPath`, `specIssuesPath`, `backlogPath`, and `tbdPath` (resolved from `StorageService`)
2. Call `LlmAgent.interactive()` with:
   - `cwd`: current working directory
   - `systemPrompt`: the planning system prompt
   - `dangerouslySkipPermissions`: `true`
3. Exit with the exit code returned by `interactive()`

The `LlmAgent` implementation (e.g., `ClaudeLlmAgent`) is responsible for spawning the underlying process with inherited stdio. The plan command does not interact with child processes directly.

Since this is an interactive session, there is no stream parsing, no event system, and no loop orchestration. The user talks to the agent directly.
