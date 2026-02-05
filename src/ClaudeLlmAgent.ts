import { Effect, Stream, Layer } from "effect"
import { spawn } from "node:child_process"
import { NodeStream } from "@effect/platform-node"
import { LlmAgent, type LlmAgentInteractiveOptions, type LlmAgentSpawnOptions } from "./LlmAgent.js"
import { DateTime } from "effect"
import {
  SystemMessage,
  AgentMessage,
  UserMessage,
  ToolCall,
  ToolResult,
  LlmSessionError,
  PingEvent,
  type LlmAgentEvent
} from "./LlmAgentEvent.js"

/**
 * Raw Claude stream-json message structure
 */
interface RawClaudeMessage {
  type: string
  subtype?: string
  message?: {
    content?: Array<{
      type: string
      text?: string
      id?: string
      name?: string
      input?: unknown
      tool_use_id?: string
      content?: string | Array<unknown>
      is_error?: boolean
    }>
  }
  tool_use_result?: {
    stdout?: string
    stderr?: string
  }
  result?: string
  error?: string
}

/**
 * Type guard for Claude messages
 */
const isClaudeMessage = (value: unknown): value is RawClaudeMessage =>
  typeof value === "object" && value !== null && "type" in value

/**
 * Convert raw Claude JSON to LlmAgentEvent(s).
 * Returns an Effect that can fail with LlmSessionError on error results,
 * or succeed with an array of events (empty array for success result, letting stream end naturally).
 */
const parseClaudeMessage = (json: unknown): Effect.Effect<Array<LlmAgentEvent>, LlmSessionError> => {
  if (!isClaudeMessage(json)) {
    return Effect.succeed([])
  }

  const events: Array<LlmAgentEvent> = []

  switch (json.type) {
    case "system":
      if (json.subtype === "init") {
        events.push(new SystemMessage({ text: "Session initialized" }))
      }
      break

    case "assistant": {
      const content = json.message?.content
      if (content) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            events.push(new AgentMessage({ text: block.text }))
          }
          if (block.type === "tool_use" && typeof block.name === "string") {
            events.push(new ToolCall({
              name: block.name,
              input: block.input ?? null
            }))
          }
        }
      }
      break
    }

    case "user": {
      const content = json.message?.content
      const toolResultData = json.tool_use_result

      if (content) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            events.push(new UserMessage({ text: block.text }))
          }
          if (block.type === "tool_result" || block.tool_use_id) {
            // block.content can be a string or an array of content blocks
            let output: string
            if (typeof block.content === "string") {
              output = block.content
            } else if (Array.isArray(block.content)) {
              // Extract text from content blocks
              output = block.content
                .map((c: unknown) => {
                  if (typeof c === "object" && c !== null && "text" in c) {
                    return (c as { text: string }).text
                  }
                  return JSON.stringify(c)
                })
                .join("\n")
            } else {
              output = toolResultData?.stdout ?? ""
            }
            events.push(new ToolResult({
              name: block.tool_use_id ?? "unknown",
              output,
              isError: block.is_error ?? false
            }))
          }
        }
      }
      break
    }

    case "result":
      if (json.subtype === "success") {
        // Success - let stream end naturally (return empty array)
        return Effect.succeed([])
      } else if (json.subtype === "error") {
        // Error - fail the stream
        return Effect.fail(new LlmSessionError({ message: json.error ?? "Unknown error" }))
      }
      break

    case "stream_event":
      // With --include-partial-messages, we get streaming events
      // Use these as activity indicator (heartbeat)
      events.push(new PingEvent({ timestamp: DateTime.nowUnsafe() }))
      break

    default:
      // Unknown message type - ignore silently
      break
  }

  return Effect.succeed(events)
}

/**
 * Try to parse a line as JSON, returning the parsed value or failing
 */
const tryParseJson = (line: string): unknown | null => {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/**
 * Create the spawn stream using native Node.js child_process with NodeStream.fromReadable
 * and Effect's stream combinators for text processing
 */
const createSpawnStream = (
  options: LlmAgentSpawnOptions
): Stream.Stream<LlmAgentEvent, LlmSessionError> => {
  // Build command arguments
  const args: Array<string> = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--disallowedTools", "AskUserQuestion"
  ]

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions")
  }

  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt)
  }

  if (options.sessionId) {
    args.push("--session-id", options.sessionId)
  }
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId)
  }

  // Add the prompt as positional argument at the end
  args.push(options.prompt)

  // Use Stream.unwrap to create a stream from an effect that spawns the process
  return Stream.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => {
        const child = spawn("claude", args, {
          cwd: options.cwd,
          stdio: ["ignore", "pipe", "pipe"]
        })
        return child
      }),
      (child) => Effect.sync(() => {
        if (!child.killed) {
          child.kill()
        }
      })
    ).pipe(
      Effect.map((child) =>
        // Use NodeStream.fromReadable to get the raw byte stream
        NodeStream.fromReadable<Uint8Array, LlmSessionError>({
          evaluate: () => child.stdout!,
          onError: (err) => new LlmSessionError({ message: err instanceof Error ? err.message : String(err) })
        }).pipe(
          // Use Effect's stream combinators for text decoding and line splitting
          Stream.decodeText("utf-8"),
          Stream.splitLines,
          // Parse each line as JSON
          Stream.map(tryParseJson),
          Stream.filter((json): json is unknown => json !== null),
          // Convert JSON to events - use mapEffect + flatMap to handle effectful parsing
          Stream.mapEffect((json: unknown) => parseClaudeMessage(json)),
          Stream.flatMap((events) => Stream.fromIterable(events))
        )
      )
    )
  )
}

/**
 * Claude implementation of the LlmAgent service
 *
 * This layer provides a complete LlmAgent implementation using Claude Code CLI.
 * Uses native Node.js child_process.spawn with NodeStream.fromReadable for better stream handling.
 */
/**
 * Run an interactive Claude session with stdio inherited
 */
const createInteractiveSession = (
  options: LlmAgentInteractiveOptions
): Effect.Effect<number, LlmSessionError> => {
  const args: Array<string> = []

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions")
  }

  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt)
  }

  return Effect.callback<number, LlmSessionError>((resume) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      stdio: "inherit"
    })
    child.on("close", (code) => {
      resume(Effect.succeed(code ?? 0))
    })
    child.on("error", (err) => {
      resume(Effect.fail(new LlmSessionError({ message: err.message })))
    })
  })
}

export const ClaudeLlmAgentLayer = Layer.succeed(
  LlmAgent,
  {
    spawn: (options) => createSpawnStream(options),
    interactive: (options) => createInteractiveSession(options)
  }
)
