# Telegram PM Mode

## Overview

When the `--telegram` flag is passed to `cuggino pm`, the PM agent runs as a Telegram bot instead of an interactive terminal session. The user communicates with the PM through a Telegram chat, and the agent responds with the same capabilities as the interactive PM mode.

## Command

```bash
cuggino pm --telegram=BOT_TOKEN
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--telegram` | _(absent)_ | Telegram bot token (from BotFather). When provided, runs the PM agent as a Telegram bot instead of an interactive terminal session. |

The bot token is passed directly as the flag value — it is not stored in config files.

## Authentication

The Telegram bot must verify that the user talking to it is the same person who launched the command. On startup:

1. The command generates a random authentication code
2. The code is printed to the console (e.g., "Auth code: 847291 — enter this in the Telegram chat to authenticate")
3. The bot starts polling for messages
4. All incoming messages are checked against the auth code until one matches
5. When the code matches, the bot records the chat ID as authenticated and replies with a confirmation message
6. From that point on, only messages from the authenticated chat ID are processed — messages from other chats are ignored

The authentication is valid for the lifetime of the command. Restarting `cuggino pm --telegram` generates a new code.

## Message Processing

### Queue

Incoming Telegram messages from the authenticated chat are placed into an in-memory Effect queue. A single consumer processes messages sequentially — one at a time, in order.

### Agent Invocation

Each message is processed by spawning the LLM agent with the same system prompt as the interactive PM mode (see [pm-command.md](./pm-command.md)).

- **First message**: The agent is spawned with a new session ID (UUIDv7, generated at command startup). This creates a fresh conversation.
- **Subsequent messages**: The agent is spawned with the resume flag, passing the same session ID. This continues the existing conversation, preserving context across messages.

The user's Telegram message is passed as the prompt to the agent.

### Session Lifecycle

A single session ID (UUIDv7) is generated when the command starts. All agent invocations share this session ID:
- First invocation: uses the session ID flag to start a new session
- All subsequent invocations: use the resume flag with the same session ID

This means the agent maintains full conversation context across all Telegram messages for the lifetime of the command.

## Telegram Bot Communication

### Polling

The bot uses the Telegram Bot API's `getUpdates` method (long polling) to receive messages. Only text messages are processed — other update types (photos, stickers, etc.) are ignored.

### Typing Indicator

Telegram's typing indicator expires after ~5 seconds, so it must be re-sent continuously while the agent is working. The bot sends `sendChatAction` with action `typing` whenever it receives an event from the LLM agent (text chunks, tool calls, tool results, etc.), debounced to every 2–3 seconds. This ensures the typing indicator stays active for the entire duration of the agent's work without flooding the Telegram API.

### Sending Responses

Agent output is sent back to the Telegram chat via `sendMessage`. The bot sends:
- **Assistant text messages** — the agent's text responses
- **Tool call activity** — a summary of tool calls the agent makes (e.g., file reads, edits, searches)

Responses are sent as plain text (no `parse_mode`). The PM system prompt is appended with an instruction telling the agent to respond in plain text without markdown formatting.

### Message Length Limit

Telegram messages are limited to 4096 characters. Responses longer than this limit must be split into multiple messages.

## Startup Flow

1. Read the bot token from the `--telegram` flag value
2. Generate UUIDv7 for the agent session
3. Generate random authentication code
4. Print auth code to console
5. Start Telegram long polling
6. Wait for authentication (match incoming message against code)
7. Confirm authentication in chat
8. Begin processing messages from the authenticated chat via the queue

## Lifecycle

- The command runs indefinitely until terminated by the user (Ctrl+C)
- On shutdown, any running agent invocation is interrupted gracefully
- The Telegram polling loop is stopped
