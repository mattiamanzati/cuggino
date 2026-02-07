# LLM Agent Abstraction

## Overview

The system uses an `LlmAgent` service to abstract over the underlying LLM provider. This allows the loop, watch service, and other consumers to spawn agents without coupling to a specific CLI tool or API.

## Responsibilities

The `LlmAgent` service is responsible for:

- **Spawning agents** in streaming mode (for loop agents: planning, implementing, reviewing, audit) or interactive mode (for PM mode)
- **Streaming output** as a stream of events that consumers can subscribe to (text chunks, tool calls, tool results, system messages)
- **Accepting configuration** such as the system prompt, user prompt, allowed tools, and the working directory

## Streaming Output

Streaming-mode agents produce a stream of events. The event types and their semantics are provider-agnostic — the abstraction normalizes provider-specific output into a common event model. Consumers (loop, CLI output) operate on this common model.

### Interactive Tool Restrictions

Streaming-mode agents run autonomously without user interaction. Providers must disable any interactive or user-facing tools (e.g., Claude's `AskUserQuestion`) that could pause the loop waiting for user input. Each provider is responsible for disabling the relevant tools using provider-specific mechanisms.

## Provider Selection

The active provider is selected at runtime via the `--agent` CLI flag (default: `claude`). A `LayerMap` service is defined with a lookup that maps agent names to their `LlmAgent` provider layers. Each command uses `Command.provide` to receive the `--agent` value, retrieve the provider layer via the `LayerMap`'s `.get(agentKey)`, and compose the dependent services (LoopService, WatchService, etc.) on top.

## Provider: Claude CLI

Uses the Claude Code CLI (`claude`), spawned as a child process. Translates between the Claude CLI's stream-json output format and the common event model.

Claude CLI-specific details (flags like `--include-partial-messages`, `--verbose`, output JSON format) are confined to this provider implementation and do not leak into the abstraction.

## Provider: Codex CLI

Uses the OpenAI Codex CLI (`codex exec`), spawned as a child process in non-interactive mode with JSONL streaming output.

### Streaming Mode

The Codex provider spawns `codex exec --json` and parses the newline-delimited JSON event stream. Codex emits events such as `thread.started`, `item.started`, `item.completed`, `turn.completed`, and `turn.failed` — the provider maps these to the common `LlmAgentEvent` model.

### System Prompt

The system prompt is injected via `--config developer_instructions="..."`. This appends to (does not replace) any project-level `AGENTS.md` file that Codex loads automatically.

### Permissions

When `dangerouslySkipPermissions` is set, the provider passes `--dangerously-bypass-approvals-and-sandbox` to disable sandboxing and auto-approve all actions.

### Considerations

- **PingEvent generation:** Codex JSONL may not emit heartbeat events at the same frequency as Claude's `stream_event`. The provider may need to emit synthetic `PingEvent`s based on any incoming JSONL line to keep the spinner alive.
- **Marker protocol:** Markers are prompt-driven and provider-agnostic — Codex follows the same system prompt instructions as Claude and emits the same XML markers in its text output.

## Adding More Providers

When adding a new LLM provider:

- Implement the `LlmAgent` service interface for the new provider
- The provider must produce the same stream event model so that the loop and CLI output work without changes
- Provider-specific configuration (API keys, model selection, etc.) should be handled within the provider implementation
- The marker protocol is prompt-driven and provider-agnostic — any LLM that follows the prompt instructions can emit markers
- Register the new provider layer alongside the existing ones so it can be selected via `--agent`

## Interactive Mode

For PM mode, the `LlmAgent` service spawns the provider in interactive mode — the user's terminal is connected directly to the agent process. The event stream is not used in this mode.
