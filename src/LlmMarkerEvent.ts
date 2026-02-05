import { Schema } from "effect"
import type { MarkerExtractorConfig } from "./extractMarkers.js"

export const LlmMarkerEventTypeId: unique symbol = Symbol.for("LlmMarkerEvent")
export type LlmMarkerEventTypeId = typeof LlmMarkerEventTypeId

export const LlmTerminalMarkerEventTypeId: unique symbol = Symbol.for("LlmTerminalMarkerEvent")
export type LlmTerminalMarkerEventTypeId = typeof LlmTerminalMarkerEventTypeId

/**
 * Note marker - general observations or comments
 */
export class Note extends Schema.Class<Note>("Note")({
  _tag: Schema.tag("Note"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId
}

/**
 * Spec issue marker - problems or ambiguities in the specification
 */
export class SpecIssue extends Schema.Class<SpecIssue>("SpecIssue")({
  _tag: Schema.tag("SpecIssue"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId;
  [LlmTerminalMarkerEventTypeId]: LlmTerminalMarkerEventTypeId = LlmTerminalMarkerEventTypeId
}

/**
 * Progress marker - status updates during execution
 */
export class Progress extends Schema.Class<Progress>("Progress")({
  _tag: Schema.tag("Progress"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId;
  [LlmTerminalMarkerEventTypeId]: LlmTerminalMarkerEventTypeId = LlmTerminalMarkerEventTypeId
}

/**
 * Done marker - task completion notification
 */
export class Done extends Schema.Class<Done>("Done")({
  _tag: Schema.tag("Done"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId;
  [LlmTerminalMarkerEventTypeId]: LlmTerminalMarkerEventTypeId = LlmTerminalMarkerEventTypeId
}

/**
 * Approved marker - approval of implementation or changes
 */
export class Approved extends Schema.Class<Approved>("Approved")({
  _tag: Schema.tag("Approved"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId;
  [LlmTerminalMarkerEventTypeId]: LlmTerminalMarkerEventTypeId = LlmTerminalMarkerEventTypeId
}

/**
 * Request changes marker - request for modifications
 */
export class RequestChanges extends Schema.Class<RequestChanges>("RequestChanges")({
  _tag: Schema.tag("RequestChanges"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId;
  [LlmTerminalMarkerEventTypeId]: LlmTerminalMarkerEventTypeId = LlmTerminalMarkerEventTypeId
}

/**
 * Plan complete marker - planning phase completed successfully
 */
export class PlanComplete extends Schema.Class<PlanComplete>("PlanComplete")({
  _tag: Schema.tag("PlanComplete"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId;
  [LlmTerminalMarkerEventTypeId]: LlmTerminalMarkerEventTypeId = LlmTerminalMarkerEventTypeId
}

/**
 * To be discussed marker - findings that need human attention/discussion
 */
export class ToBeDiscussed extends Schema.Class<ToBeDiscussed>("ToBeDiscussed")({
  _tag: Schema.tag("ToBeDiscussed"),
  content: Schema.String
}) {
  [LlmMarkerEventTypeId]: LlmMarkerEventTypeId = LlmMarkerEventTypeId
}

/**
 * Union of all LLM marker events
 */
export type LlmMarkerEvent =
  | Note
  | SpecIssue
  | Progress
  | Done
  | Approved
  | RequestChanges
  | PlanComplete
  | ToBeDiscussed

/**
 * Schema for encoding/decoding LlmMarkerEvent
 */
export const LlmMarkerEventSchema = Schema.Union([
  Note,
  SpecIssue,
  Progress,
  Done,
  Approved,
  RequestChanges,
  PlanComplete,
  ToBeDiscussed
])

export type LlmTerminalMarkerEvent =
  | SpecIssue
  | PlanComplete
  | Progress
  | Done
  | Approved
  | RequestChanges

export type LlmInfoMarkerEvent = Note | ToBeDiscussed

export const isLlmMarkerEvent = (event: unknown): event is LlmMarkerEvent =>
  typeof event === "object" && event !== null && LlmMarkerEventTypeId in event

export const isLlmTerminalMarkerEvent = (event: unknown): event is LlmTerminalMarkerEvent =>
  typeof event === "object" && event !== null && LlmTerminalMarkerEventTypeId in event

/**
 * Default marker extraction config for cuggino markers.
 * Maps XML tag names to factory functions that create the corresponding LlmMarkerEvent.
 */
export const defaultMarkerConfig: MarkerExtractorConfig<{
  NOTE: Note
  SPEC_ISSUE: SpecIssue
  PROGRESS: Progress
  DONE: Done
  APPROVED: Approved
  REQUEST_CHANGES: RequestChanges
  PLAN_COMPLETE: PlanComplete
  TO_BE_DISCUSSED: ToBeDiscussed
}> = {
  NOTE: (content) => new Note({ content }),
  SPEC_ISSUE: (content) => new SpecIssue({ content }),
  PROGRESS: (content) => new Progress({ content }),
  DONE: (content) => new Done({ content }),
  APPROVED: (content) => new Approved({ content }),
  REQUEST_CHANGES: (content) => new RequestChanges({ content }),
  PLAN_COMPLETE: (content) => new PlanComplete({ content }),
  TO_BE_DISCUSSED: (content) => new ToBeDiscussed({ content })
}
