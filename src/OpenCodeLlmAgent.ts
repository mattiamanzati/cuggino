import { Effect, Stream, Layer, DateTime } from "effect"
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { NodeStream } from "@effect/platform-node"
import { LlmAgent, type LlmAgentInteractiveOptions, type LlmAgentSpawnOptions } from "./LlmAgent.js"
import {
  SystemMessage,
  AgentMessage,
  LlmSessionError,
  PingEvent,
  type LlmAgentEvent
} from "./LlmAgentEvent.js"

/**
 * Raw OpenCode NDJSON event structure
 */
interface RawOpenCodeEvent {
  type: string
  text?: string
}

/**
 * Type guard for OpenCode events
 */
const isOpenCodeEvent = (value: unknown): value is RawOpenCodeEvent =>
  typeof value === "object" && value !== null && "type" in value

/**
 * Convert raw OpenCode JSON to LlmAgentEvent(s).
 */
const parseOpenCodeEvent = (json: unknown): Effect.Effect<Array<LlmAgentEvent>, LlmSessionError> => {
  if (!isOpenCodeEvent(json)) {
    return Effect.succeed([new PingEvent({ timestamp: DateTime.nowUnsafe() })])
  }

  switch (json.type) {
    case "step_start":
      return Effect.succeed([new SystemMessage({ text: "Session initialized" })])

    case "text":
      if (typeof json.text === "string") {
        return Effect.succeed([new AgentMessage({ text: json.text })])
      }
      return Effect.succeed([new PingEvent({ timestamp: DateTime.nowUnsafe() })])

    case "step_finish":
      // Stream ends naturally
      return Effect.succeed([])

    default:
      // Unknown event type - emit PingEvent as heartbeat
      return Effect.succeed([new PingEvent({ timestamp: DateTime.nowUnsafe() })])
  }
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
 * Create the spawn stream for OpenCode using `opencode run --format json`
 */
const createSpawnStream = (
  options: LlmAgentSpawnOptions
): Stream.Stream<LlmAgentEvent, LlmSessionError> => {
  const args: Array<string> = ["run", "--format", "json"]

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions")
  }

  // Add the prompt as the final positional argument
  args.push(options.prompt)

  // Build environment with optional system prompt injection
  const buildEnvAndSpawn = options.systemPrompt
    ? Effect.acquireRelease(
        Effect.sync(() => {
          // Write system prompt to temp file inside .cuggino/
          const cugginoDir = path.join(options.cwd, ".cuggino")
          fs.mkdirSync(cugginoDir, { recursive: true })
          const tmpName = `tmp-prompt-${crypto.randomUUID()}.md`
          const tmpPath = path.join(cugginoDir, tmpName)
          fs.writeFileSync(tmpPath, options.systemPrompt!)

          const env = {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [`.cuggino/${tmpName}`] })
          }

          const child = spawn("opencode", args, {
            cwd: options.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env
          })

          return { child, tmpPath }
        }),
        ({ child, tmpPath }) => Effect.sync(() => {
          if (!child.killed) {
            child.kill()
          }
          try {
            fs.unlinkSync(tmpPath)
          } catch {
            // Ignore cleanup errors
          }
        })
      )
    : Effect.acquireRelease(
        Effect.sync(() => {
          const child = spawn("opencode", args, {
            cwd: options.cwd,
            stdio: ["ignore", "pipe", "pipe"]
          })
          return { child, tmpPath: null as string | null }
        }),
        ({ child }) => Effect.sync(() => {
          if (!child.killed) {
            child.kill()
          }
        })
      )

  return Stream.unwrap(
    buildEnvAndSpawn.pipe(
      Effect.map(({ child }) => {
        const stdoutStream = NodeStream.fromReadable<Uint8Array, LlmSessionError>({
          evaluate: () => child.stdout!,
          onError: (err) => new LlmSessionError({ message: err instanceof Error ? err.message : String(err) })
        }).pipe(
          Stream.decodeText("utf-8"),
          Stream.splitLines,
          Stream.map(tryParseJson),
          Stream.filter((json): json is unknown => json !== null),
          Stream.mapEffect((json: unknown) => parseOpenCodeEvent(json)),
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
 * Run an interactive OpenCode session with stdio inherited
 */
const createInteractiveSession = (
  options: LlmAgentInteractiveOptions
): Effect.Effect<number, LlmSessionError> => {
  const args: Array<string> = []

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions")
  }

  return Effect.callback<number, LlmSessionError>((resume) => {
    const child = spawn("opencode", args, {
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

export const OpenCodeLlmAgentLayer = Layer.succeed(
  LlmAgent,
  {
    spawn: (options) => createSpawnStream(options),
    interactive: (options) => createInteractiveSession(options)
  }
)
