import { Effect, Stream, Layer, DateTime } from "effect"
import { spawn } from "node:child_process"
import { NodeStream } from "@effect/platform-node"
import { LlmAgent, type LlmAgentInteractiveOptions, type LlmAgentSpawnOptions } from "./LlmAgent.js"
import {
  SystemMessage,
  AgentMessage,
  ToolCall,
  ToolResult,
  LlmSessionError,
  PingEvent,
  type LlmAgentEvent
} from "./LlmAgentEvent.js"

/**
 * Raw Codex JSONL event structure
 */
interface RawCodexEvent {
  type: string
  item?: {
    id?: string
    type?: string
    name?: string
    arguments?: unknown
    text?: string
    command?: string
    aggregated_output?: string
    exit_code?: number | null
    output?: string
    status?: string
    content?: Array<{
      type: string
      text?: string
    }>
  }
  error?: string
}

/**
 * Type guard for Codex events
 */
const isCodexEvent = (value: unknown): value is RawCodexEvent =>
  typeof value === "object" && value !== null && "type" in value

const parseToolInput = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value ?? null
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const developerInstructionsConfig = (systemPrompt: string): string =>
  `developer_instructions=${JSON.stringify(systemPrompt)}`

/**
 * Convert raw Codex JSON to LlmAgentEvent(s).
 * Returns an Effect that can fail with LlmSessionError on turn.failed,
 * or succeed with an array of events (empty array for turn.completed, letting stream end naturally).
 */
const parseCodexEvent = (json: unknown): Effect.Effect<Array<LlmAgentEvent>, LlmSessionError> => {
  if (!isCodexEvent(json)) {
    return Effect.succeed([new PingEvent({ timestamp: DateTime.nowUnsafe() })])
  }

  const events: Array<LlmAgentEvent> = []

  switch (json.type) {
    case "thread.started":
      events.push(new SystemMessage({ text: "Session initialized" }))
      break

    case "item.started":
      if (json.item?.type === "function_call" && typeof json.item.name === "string") {
        events.push(new ToolCall({
          name: json.item.name,
          input: parseToolInput(json.item.arguments)
        }))
      } else if (json.item?.type === "command_execution" && typeof json.item.command === "string") {
        events.push(new ToolCall({
          name: "Bash",
          input: { command: json.item.command }
        }))
      }
      break

    case "item.completed":
      if (json.item?.type === "function_call_output") {
        events.push(new ToolResult({
          name: json.item.name ?? "unknown",
          output: json.item.output ?? "",
          isError: json.item.status === "error"
        }))
      } else if (json.item?.type === "command_execution") {
        events.push(new ToolResult({
          name: "Bash",
          output: json.item.aggregated_output ?? "",
          isError: json.item.status === "error" || (typeof json.item.exit_code === "number" && json.item.exit_code !== 0)
        }))
      } else if (json.item?.type === "agent_message" && typeof json.item.text === "string") {
        events.push(new AgentMessage({ text: json.item.text }))
      } else if (json.item?.type === "message" && json.item.content) {
        for (const block of json.item.content) {
          if (block.type === "text" && typeof block.text === "string") {
            events.push(new AgentMessage({ text: block.text }))
          }
        }
      }
      break

    case "turn.completed":
      // Stream ends naturally
      return Effect.succeed([])

    case "turn.failed":
      return Effect.fail(new LlmSessionError({ message: json.error ?? "Codex turn failed" }))

    default:
      // Unknown event type - emit a PingEvent as fallback below
      break
  }

  return Effect.succeed(
    events.length > 0
      ? events
      : [new PingEvent({ timestamp: DateTime.nowUnsafe() })]
  )
}

/**
 * Try to parse a line as JSON, returning the parsed value or null
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
 * Create the spawn stream for Codex using `codex exec --json`
 */
const createSpawnStream = (
  options: LlmAgentSpawnOptions
): Stream.Stream<LlmAgentEvent, LlmSessionError> => {
  const args: Array<string> = ["exec", "--json"]

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-bypass-approvals-and-sandbox")
  }

  if (options.systemPrompt) {
    args.push("--config", developerInstructionsConfig(options.systemPrompt))
  }

  // Add the prompt as the final positional argument
  args.push(options.prompt)

  return Stream.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => {
        const child = spawn("codex", args, {
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
      Effect.map((child) => {
        const stdoutStream = NodeStream.fromReadable<Uint8Array, LlmSessionError>({
          evaluate: () => child.stdout!,
          onError: (err) => new LlmSessionError({ message: err instanceof Error ? err.message : String(err) })
        }).pipe(
          Stream.decodeText("utf-8"),
          Stream.splitLines,
          Stream.map(tryParseJson),
          Stream.filter((json): json is unknown => json !== null),
          Stream.mapEffect((json: unknown) => parseCodexEvent(json)),
          Stream.flatMap((events) => Stream.fromIterable(events))
        )

        const stderrStream = NodeStream.fromReadable<Uint8Array, LlmSessionError>({
          evaluate: () => child.stderr!,
          onError: (err) => new LlmSessionError({ message: err instanceof Error ? err.message : String(err) })
        }).pipe(
          Stream.decodeText("utf-8"),
          Stream.splitLines,
          Stream.map(() => [] as Array<LlmAgentEvent>),
          Stream.flatMap((events) => Stream.fromIterable(events))
        )

        return Stream.merge(stdoutStream, stderrStream)
      })
    )
  )
}

/**
 * Run an interactive Codex session with stdio inherited
 */
const createInteractiveSession = (
  options: LlmAgentInteractiveOptions
): Effect.Effect<number, LlmSessionError> => {
  const args: Array<string> = []

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-bypass-approvals-and-sandbox")
  }

  if (options.systemPrompt) {
    args.push("--config", developerInstructionsConfig(options.systemPrompt))
  }

  return Effect.callback<number, LlmSessionError>((resume) => {
    const child = spawn("codex", args, {
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

export const CodexLlmAgentLayer = Layer.succeed(
  LlmAgent,
  {
    spawn: (options) => createSpawnStream(options),
    interactive: (options) => createInteractiveSession(options)
  }
)
