import { describe, it, expect } from "vitest"
import { Effect, Layer, Stream } from "effect"
import { LlmAgent } from "../../src/LlmAgent.js"
import { CodexLlmAgentLayer } from "../../src/CodexLlmAgent.js"
import { extractMarkers } from "../../src/extractMarkers.js"
import { defaultMarkerConfig } from "../../src/LlmMarkerEvent.js"
import { NodeServices } from "@effect/platform-node"

describe("Codex LlmAgent E2E", () => {
  it("should spawn Codex and receive events", async () => {
    const program = Effect.gen(function*() {
      const agent = yield* LlmAgent

      const events = agent.spawn({
        prompt: 'Say exactly: "Hello!"',
        cwd: process.cwd(),
        dangerouslySkipPermissions: true
      })

      // Collect all events
      const collected = yield* events.pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk))
      )

      // Should have at least some events
      expect(collected.length).toBeGreaterThan(0)

      // Find AgentMessage events
      const agentMessages = collected.filter((e) => e._tag === "AgentMessage")
      expect(agentMessages.length).toBeGreaterThan(0)

      // Stream should complete successfully (no more SessionSuccess/SessionError events)
      // The stream ends naturally on success, or fails with LlmSessionError on error
      return collected
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(CodexLlmAgentLayer.pipe(Layer.provide(NodeServices.layer))),
        Effect.scoped
      )
    )

    console.log("Received events:", result.map((e) => e._tag))
  }, 120000)

  it("should extract markers from Codex output", async () => {
    const program = Effect.gen(function*() {
      const agent = yield* LlmAgent

      const events = agent.spawn({
        prompt: 'Say exactly: <NOTE>Test note</NOTE>',
        cwd: process.cwd(),
        dangerouslySkipPermissions: true
      })

      const eventsWithMarkers = extractMarkers(events, defaultMarkerConfig)

      const collected = yield* eventsWithMarkers.pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk))
      )

      // Find Note markers
      const noteEvents = collected.filter((e) => e._tag === "Note")
      expect(noteEvents.length).toBeGreaterThan(0)

      return collected
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(CodexLlmAgentLayer.pipe(Layer.provide(NodeServices.layer))),
        Effect.scoped
      )
    )

    console.log("Received events with markers:", result.map((e) => e._tag))
  }, 120000)

  it("should emit tool call and tool result events", async () => {
    const program = Effect.gen(function*() {
      const agent = yield* LlmAgent

      const events = agent.spawn({
        prompt: "Use the Bash tool to run: echo TOOL_CALL_OK",
        cwd: process.cwd(),
        dangerouslySkipPermissions: true
      })

      const collected = yield* events.pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk))
      )

      const toolCalls = collected.filter((e) => e._tag === "ToolCall")
      const toolResults = collected.filter((e) => e._tag === "ToolResult")

      expect(toolCalls.length).toBeGreaterThan(0)
      expect(toolResults.length).toBeGreaterThan(0)

      return collected
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(CodexLlmAgentLayer.pipe(Layer.provide(NodeServices.layer))),
        Effect.scoped
      )
    )

    console.log("Received tool call events:", result.map((e) => e._tag))
  }, 120000)

  it("should handle systemPrompt with special characters safely", async () => {
    const program = Effect.gen(function*() {
      const agent = yield* LlmAgent
      const systemPrompt = [
        "Rules:",
        "1) Keep output exact",
        "2) Preserve chars: = / \\\\ \" '",
        "3) Path example: src/a=b/file.ts",
        "4) Regex-ish: ^foo=bar$/",
        "Done."
      ].join("\n")

      const events = agent.spawn({
        prompt: 'Say exactly: "System prompt escaped"',
        cwd: process.cwd(),
        dangerouslySkipPermissions: true,
        systemPrompt
      })

      const collected = yield* events.pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk))
      )

      const agentMessages = collected.filter((e) => e._tag === "AgentMessage")
      expect(agentMessages.length).toBeGreaterThan(0)

      return collected
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(CodexLlmAgentLayer.pipe(Layer.provide(NodeServices.layer))),
        Effect.scoped
      )
    )

    console.log("Received events with special-char systemPrompt:", result.map((e) => e._tag))
  }, 120000)
})
