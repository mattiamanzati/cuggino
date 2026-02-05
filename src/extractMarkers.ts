import { Stream } from "effect"
import { AgentMessage, type LlmAgentEvent } from "./LlmAgentEvent.js"

/**
 * Configuration for marker extraction.
 * Maps marker tag names (as they appear in XML tags) to factory functions
 * that create the marker event from the extracted content.
 *
 * @example
 * ```typescript
 * const config = {
 *   NOTE: (content) => ({ _tag: "Note" as const, content }),
 *   SPEC_ISSUE: (content) => ({ _tag: "SpecIssue" as const, content })
 * }
 * ```
 */
export type MarkerExtractorConfig<TMarkers extends Record<string, unknown>> = {
  readonly [K in keyof TMarkers]: (content: string) => TMarkers[K]
}

/**
 * Infer the union type of marker events from a config
 */
export type MarkerEventsFromConfig<TConfig extends MarkerExtractorConfig<Record<string, unknown>>> =
  TConfig[keyof TConfig] extends (content: string) => infer R ? R : never

// Regex to match XML-style markers
const createMarkerRegex = (tag: string) =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")

/**
 * A segment in the extraction result - either a marker or a text segment
 */
type Segment<TMarkers> =
  | { readonly type: "marker"; readonly value: TMarkers[keyof TMarkers]; readonly position: number }
  | { readonly type: "text"; readonly value: string; readonly position: number }

/**
 * Extract markers from text and return an ordered array of segments
 * (markers and text) in the order they appear in the original text.
 */
const extractAndStripMarkers = <TMarkers extends Record<string, unknown>>(
  text: string,
  config: MarkerExtractorConfig<TMarkers>
): Array<Segment<TMarkers>> => {
  // Collect all marker matches with their positions
  interface MarkerMatch {
    marker: TMarkers[keyof TMarkers]
    startIndex: number
    endIndex: number
  }

  const matches: Array<MarkerMatch> = []

  for (const [tag, factory] of Object.entries(config)) {
    const regex = createMarkerRegex(tag)
    for (const match of text.matchAll(regex)) {
      matches.push({
        marker: factory(match[1].trim()) as TMarkers[keyof TMarkers],
        startIndex: match.index!,
        endIndex: match.index! + match[0].length
      })
    }
  }

  // Sort by start index to preserve order of appearance in text
  matches.sort((a, b) => a.startIndex - b.startIndex)

  // Build ordered segments (text and markers interleaved)
  const segments: Array<Segment<TMarkers>> = []
  let currentPosition = 0

  for (const match of matches) {
    // Add text segment before this marker (if any non-whitespace content)
    if (match.startIndex > currentPosition) {
      const textBefore = text.slice(currentPosition, match.startIndex).trim()
      if (textBefore.length > 0) {
        segments.push({ type: "text", value: textBefore, position: currentPosition })
      }
    }

    // Add the marker segment
    segments.push({ type: "marker", value: match.marker, position: match.startIndex })

    currentPosition = match.endIndex
  }

  // Add any remaining text after the last marker
  if (currentPosition < text.length) {
    const textAfter = text.slice(currentPosition).trim()
    if (textAfter.length > 0) {
      segments.push({ type: "text", value: textAfter, position: currentPosition })
    }
  }

  return segments
}

/**
 * Stream transformer that takes a stream of LlmAgentEvents and extracts markers
 * from AgentMessage events.
 *
 * For AgentMessage events containing markers:
 * - Markers are extracted and emitted as separate events (in order of appearance)
 * - Marker tags are stripped from the text
 * - If remaining text is non-empty, a cleaned AgentMessage is also emitted
 * - If the text only contains markers (no remaining text), no AgentMessage is emitted
 *
 * Non-AgentMessage events pass through unchanged.
 *
 * The markers to extract are configured via the config parameter, which maps
 * tag names to factory functions.
 *
 * @example
 * ```typescript
 * import { Data } from "effect"
 *
 * // Define marker events using Data.TaggedEnum
 * type MarkerEvent = Data.TaggedEnum<{
 *   Note: { readonly content: string }
 *   SpecIssue: { readonly content: string }
 * }>
 * const MarkerEvent = Data.taggedEnum<MarkerEvent>()
 *
 * // Configure extraction
 * const config = {
 *   NOTE: (content: string) => MarkerEvent.Note({ content }),
 *   SPEC_ISSUE: (content: string) => MarkerEvent.SpecIssue({ content })
 * }
 *
 * // Use with stream
 * const eventsWithMarkers = extractMarkers(llmEvents, config)
 * ```
 */
export const extractMarkers = <E, R, TMarkers extends Record<string, unknown>>(
  stream: Stream.Stream<LlmAgentEvent, E, R>,
  config: MarkerExtractorConfig<TMarkers>
): Stream.Stream<LlmAgentEvent | TMarkers[keyof TMarkers], E, R> => {
  return stream.pipe(
    Stream.flatMap((event) => {
      // Non-AgentMessage events pass through unchanged
      if (event._tag !== "AgentMessage") {
        return Stream.succeed(event)
      }

      // Extract ordered segments (markers and text interleaved)
      const segments = extractAndStripMarkers(event.text, config)

      // Map segments to events in order
      const events: Array<LlmAgentEvent | TMarkers[keyof TMarkers]> = segments.map((segment) =>
        segment.type === "marker" ? segment.value : new AgentMessage({ text: segment.value })
      )

      return Stream.fromIterable(events)
    })
  )
}
