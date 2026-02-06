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

## Provider: Claude CLI

The current (and only) provider implementation uses the Claude Code CLI (`claude`), spawned as a child process. This provider translates between the Claude CLI's output format and the common event model.

Claude CLI-specific details (flags like `--include-partial-messages`, `--verbose`, output JSON format) are confined to this provider implementation and do not leak into the abstraction.

## Future Providers

When adding a new LLM provider:

- Implement the `LlmAgent` service interface for the new provider
- The provider must produce the same stream event model so that the loop and CLI output work without changes
- Provider-specific configuration (API keys, model selection, etc.) should be handled within the provider implementation
- The marker protocol (how agents signal progress, completion, spec issues, etc.) is prompt-driven and provider-agnostic — any LLM that follows the prompt instructions can emit markers

## Interactive Mode

For PM mode, the `LlmAgent` service spawns the provider in interactive mode — the user's terminal is connected directly to the agent process. The event stream is not used in this mode.
