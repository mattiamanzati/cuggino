# PM Mode (Default Command)

## Overview

Running `cuggino` with no subcommand starts an interactive Claude session in **project manager (PM) mode**. The agent acts as a project manager — reading specs, discussing features with the user, writing specifications, managing the backlog, and resolving spec issues. The PM does not write code.

## Command

```bash
cuggino
```

No CLI options. The `specsPath` configuration is read from `.cuggino.json`, and the PM also relies on the standard `.cuggino/` folder structure (`spec-issues/`, `backlog/`, `tbd/`) via `StorageService`. See [setup-command](./setup-command.md) and [storage](./storage.md) for details.

## Behavior

The root command handler spawns an interactive Claude agent with a system prompt that constrains it to the PM role. The user interacts with the agent directly in their terminal — there is no stream parsing, no event system, and no loop orchestration.

### What the Agent Can Do

- Read existing spec files to understand the current state
- Discuss features, trade-offs, and design decisions with the user
- Write and edit files **only** inside the specs folder, the spec issues folder, the backlog folder, and the TBD folder
- Review and critique existing specifications
- Propose new specifications
- Propose features, bug fixes, or tasks — and upon user confirmation, create backlog items (not implement them)
- Check for pending spec issues and prompt the user to discuss them
- Resolve spec issues by updating specs and deleting the issue file
- Check for pending TBD items (lower priority than spec issues) and prompt the user to discuss them
- Resolve TBD items by updating specs (or creating backlog items) and deleting the TBD file

### What the Agent Must NOT Do

- Write or modify any file outside the specs folder, spec issues folder, backlog folder, and TBD folder
- Run code, tests, or build commands
- Implement features or write code — it must create backlog items instead

## System Prompt

The system prompt instructs the agent to act as a PM with the following constraints:

- May only write or edit files inside the specs, spec-issues, backlog, and TBD folders
- Must not write source code, configuration files, or scripts
- Must be critical and thorough when reviewing specifications
- Must ask clarifying questions when requirements are ambiguous
- Must consider edge cases, error handling, and potential conflicts with existing specs
- Must follow the conventions of existing spec files
- Must prefer interactive tools (e.g., AskUserQuestion) for gathering input

### Backlog Management

- When features/tasks are agreed upon, creates backlog files (one per task) instead of implementing
- Backlog items are coarse-grained (milestones, features, user stories)
- Each backlog file is short and points to relevant spec files
- Files are named for alphabetical execution order (e.g., `001-add-auth.md`)
- Always proposes the list and asks for confirmation before creating

### Spec Issue Handling

- Checks the spec-issues folder for pending issues at natural stopping points
- Prompts the user to discuss pending issues
- Resolves by updating specs and deleting the issue file

### TBD Item Handling

- Lower priority than spec issues
- Checks the TBD folder when no spec issues are pending
- Prompts the user to discuss pending items
- Never dismisses a TBD item about an implementation issue without asking the user
- Resolves by updating specs or creating backlog items, then deleting the TBD file

## Interactive Session

The PM session uses the agent's interactive mode — stdio is inherited so the user talks directly to the agent. The session runs with `dangerouslySkipPermissions: true` and exits with the agent's exit code.
