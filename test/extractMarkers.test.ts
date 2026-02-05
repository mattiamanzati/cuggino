import { describe, it, expect } from "vitest"
import { Effect, Stream } from "effect"
import {
  SystemMessage,
  AgentMessage,
  ToolCall,
  ToolResult,
  type LlmAgentEvent
} from "../src/LlmAgentEvent.js"
import { extractMarkers } from "../src/extractMarkers.js"
import { Note, SpecIssue, Progress, Done, Approved, RequestChanges, ToBeDiscussed, defaultMarkerConfig, isLlmMarkerEvent, isLlmTerminalMarkerEvent } from "../src/LlmMarkerEvent.js"

// Helper to collect stream into array
const collectStream = <A, E>(stream: Stream.Stream<A, E, never>): Effect.Effect<Array<A>, E> =>
  Stream.runCollect(stream).pipe(Effect.map((chunk) => Array.from(chunk)))

describe("extractMarkers", () => {
  describe("passthrough behavior", () => {
    it("should pass through non-AgentMessage events unchanged", async () => {
      const events: Array<LlmAgentEvent> = [
        new SystemMessage({ text: "Session started" }),
        new ToolCall({ name: "Bash", input: { command: "ls" } }),
        new ToolResult({ name: "Bash", output: "file.txt", isError: false })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      expect(result).toHaveLength(3)
      expect(result[0]._tag).toBe("SystemMessage")
      expect(result[1]._tag).toBe("ToolCall")
      expect(result[2]._tag).toBe("ToolResult")
    })

    it("should pass through AgentMessage events without markers", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({ text: "Hello, no markers here!" })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      expect(result).toHaveLength(1)
      expect(result[0]._tag).toBe("AgentMessage")
      if (result[0]._tag === "AgentMessage") {
        expect(result[0].text).toBe("Hello, no markers here!")
      }
    })
  })

  describe("marker extraction and text stripping", () => {
    it("should extract NOTE marker and emit text segments in order with marker", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({ text: "Some text <NOTE>This is a note</NOTE> more text" })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Events in text order: text, marker, text
      expect(result).toHaveLength(3)
      expect(result[0]._tag).toBe("AgentMessage")
      if (result[0]._tag === "AgentMessage") {
        expect(result[0].text).toBe("Some text")
      }
      expect(result[1]).toEqual(new Note({ content: "This is a note" }))
      expect(result[2]._tag).toBe("AgentMessage")
      if (result[2]._tag === "AgentMessage") {
        expect(result[2].text).toBe("more text")
      }
    })

    it("should not emit AgentMessage when text contains only markers", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({ text: "<SPEC_ISSUE>The spec is unclear about X</SPEC_ISSUE>" })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker, no AgentMessage since text is empty after stripping
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new SpecIssue({ content: "The spec is unclear about X" }))
    })

    it("should extract multiple NOTE markers in order with interleaved text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<NOTE>First note</NOTE> middle <NOTE>Second note</NOTE>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Events in text order: Note, text, Note
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(new Note({ content: "First note" }))
      expect(result[1]._tag).toBe("AgentMessage")
      if (result[1]._tag === "AgentMessage") {
        expect(result[1].text).toBe("middle")
      }
      expect(result[2]).toEqual(new Note({ content: "Second note" }))
    })
  })

  describe("PROGRESS marker", () => {
    it("should extract PROGRESS marker from text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<PROGRESS>Completed task 1, moving to task 2</PROGRESS>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker, no AgentMessage
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new Progress({ content: "Completed task 1, moving to task 2" }))
    })
  })

  describe("DONE marker", () => {
    it("should extract DONE marker from text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<DONE>All tasks completed successfully</DONE>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new Done({ content: "All tasks completed successfully" }))
    })
  })

  describe("APPROVED marker", () => {
    it("should extract APPROVED marker from text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<APPROVED>Implementation matches specs</APPROVED>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new Approved({ content: "Implementation matches specs" }))
    })
  })

  describe("REQUEST_CHANGES marker", () => {
    it("should extract REQUEST_CHANGES marker from text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<REQUEST_CHANGES>Missing error handling</REQUEST_CHANGES>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new RequestChanges({ content: "Missing error handling" }))
    })
  })

  describe("mixed markers", () => {
    it("should extract multiple different markers in order they appear with interleaved text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: `<NOTE>Found an issue</NOTE> Some explanation here <SPEC_ISSUE>Spec unclear</SPEC_ISSUE>`
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Events in text order: Note, text, SpecIssue
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(new Note({ content: "Found an issue" }))
      expect(result[1]._tag).toBe("AgentMessage")
      if (result[1]._tag === "AgentMessage") {
        expect(result[1].text).toBe("Some explanation here")
      }
      expect(result[2]).toEqual(new SpecIssue({ content: "Spec unclear" }))
    })

    it("should emit events in text order (marker, text, marker) - spec example", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<NOTE>\nFound issue\n</NOTE>\n\nFixing it.\n\n<DONE>\nDone.\n</DONE>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Events in text order: Note, AgentMessage, Done
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(new Note({ content: "Found issue" }))
      expect(result[1]._tag).toBe("AgentMessage")
      if (result[1]._tag === "AgentMessage") {
        expect(result[1].text).toBe("Fixing it.")
      }
      expect(result[2]).toEqual(new Done({ content: "Done." }))
    })
  })

  describe("multiline content", () => {
    it("should extract markers with multiline content", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: `<NOTE>
This is a note
that spans multiple lines
with various content
</NOTE>`
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker (no remaining text)
      expect(result).toHaveLength(1)
      expect(result[0]._tag).toBe("Note")
      if (result[0]._tag === "Note") {
        expect(result[0].content).toContain("multiple lines")
      }
    })
  })

  describe("whitespace handling", () => {
    it("should trim whitespace from marker content", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({
          text: "<NOTE>   trimmed content   </NOTE>"
        })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      // Only marker (content trimmed)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new Note({ content: "trimmed content" }))
    })
  })

  describe("TO_BE_DISCUSSED marker", () => {
    it("should extract TO_BE_DISCUSSED marker from text", async () => {
      const events: Array<LlmAgentEvent> = [
        new AgentMessage({ text: "<TO_BE_DISCUSSED>\nSpec says X but code does Y\n</TO_BE_DISCUSSED>" })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, defaultMarkerConfig)))

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(ToBeDiscussed)
      expect((result[0] as any).content).toBe("Spec says X but code does Y")
    })

    it("ToBeDiscussed is a marker event but not terminal", () => {
      const event = new ToBeDiscussed({ content: "test" })
      expect(isLlmMarkerEvent(event)).toBe(true)
      expect(isLlmTerminalMarkerEvent(event)).toBe(false)
    })
  })

  describe("custom config", () => {
    it("should work with custom marker config", async () => {
      // Custom marker type
      type CustomMarker = { _tag: "CustomNote"; message: string }

      const customConfig = {
        CUSTOM: (content: string): CustomMarker => ({ _tag: "CustomNote", message: content })
      }

      const events: Array<LlmAgentEvent> = [
        new AgentMessage({ text: "<CUSTOM>Hello custom!</CUSTOM>" })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, customConfig)))

      // Only marker (no remaining text)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ _tag: "CustomNote", message: "Hello custom!" })
    })

    it("should emit marker and text segments in order for custom config", async () => {
      type CustomMarker = { _tag: "CustomNote"; message: string }

      const customConfig = {
        CUSTOM: (content: string): CustomMarker => ({ _tag: "CustomNote", message: content })
      }

      const events: Array<LlmAgentEvent> = [
        new AgentMessage({ text: "Before <CUSTOM>content</CUSTOM> after" })
      ]

      const stream = Stream.fromIterable(events)
      const result = await Effect.runPromise(collectStream(extractMarkers(stream, customConfig)))

      // Events in text order: text, marker, text
      expect(result).toHaveLength(3)
      expect(result[0]._tag).toBe("AgentMessage")
      if (result[0]._tag === "AgentMessage") {
        expect(result[0].text).toBe("Before")
      }
      expect(result[1]).toEqual({ _tag: "CustomNote", message: "content" })
      expect(result[2]._tag).toBe("AgentMessage")
      if (result[2]._tag === "AgentMessage") {
        expect(result[2].text).toBe("after")
      }
    })
  })
})
