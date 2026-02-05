# cuggino

> **WARNING:** This tool runs Claude in dangerous mode (`--dangerously-skip-permissions`).
> **Only use it inside a sandbox or virtual machine.** It grants the AI agent unrestricted
> access to execute commands, modify files, and interact with your system without confirmation prompts.

**Why "cuggino"?** The name comes from an Italian saying — when you have an app idea, there's always a *cugino* (cousin) who can build it for cheap.

An autonomous coding loop CLI that orchestrates AI agents to plan, implement, and review code changes against specs.

**Specs-driven workflow:** define your project specifications in a `.specs/` folder, and the system autonomously plans, implements, and reviews changes to match them. Tasks are queued as markdown files in `.cuggino/backlog/` and picked up in filename order.

## Commands

### `cuggino run`

Executes a single coding loop for a given focus.

**Options:** `--focus`, `--specs`, `--max-iterations`, `--check-command`, `--commit`

### `cuggino watch`

Continuously processes backlog items, watches for new items, and handles spec issues.

**Options:** `--specs`, `--max-iterations`, `--check-command`, `--commit`, `--audit`

### `cuggino plan`

Spawns an interactive Claude session for discussing and writing specifications.

**Options:** `--specs`

### `cuggino setup`

Interactively configures the project (specs path, max iterations, check command, commit, audit). Writes configuration to `.cuggino.json`.

## Specs-Driven Workflow

Specifications live in the `.specs/` folder. The backlog system (`.cuggino/backlog/`) queues tasks as markdown files, processed in filename order.

The agent loop iterates through: **Planning** → **Implementing** → **Reviewing** — repeating until the implementation matches the specs or the iteration limit is reached.

For detailed specifications, see the `.specs/` folder.
