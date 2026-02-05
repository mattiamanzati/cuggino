import { Schema } from "effect"
import type { LlmAgentEvent } from "./LlmAgentEvent.js"
import type { LlmMarkerEvent } from "./LlmMarkerEvent.js"

export const LoopPhaseEventTypeId: unique symbol = Symbol.for("LoopPhaseEvent")
export type LoopPhaseEventTypeId = typeof LoopPhaseEventTypeId

export const LoopTerminalEventTypeId: unique symbol = Symbol.for("LoopTerminalEvent")
export type LoopTerminalEventTypeId = typeof LoopTerminalEventTypeId

/**
 * Iteration start event - emitted at the beginning of each iteration
 */
export class IterationStart extends Schema.Class<IterationStart>("IterationStart")({
  _tag: Schema.tag("IterationStart"),
  iteration: Schema.Number,
  maxIterations: Schema.Number
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Planning phase start event
 */
export class PlanningStart extends Schema.Class<PlanningStart>("PlanningStart")({
  _tag: Schema.tag("PlanningStart"),
  iteration: Schema.Number
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Implementation phase start event
 */
export class ImplementingStart extends Schema.Class<ImplementingStart>("ImplementingStart")({
  _tag: Schema.tag("ImplementingStart"),
  iteration: Schema.Number
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Reviewing phase start event
 */
export class ReviewingStart extends Schema.Class<ReviewingStart>("ReviewingStart")({
  _tag: Schema.tag("ReviewingStart"),
  iteration: Schema.Number
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Setup command output event
 */
export class SetupCommandOutput extends Schema.Class<SetupCommandOutput>("SetupCommandOutput")({
  _tag: Schema.tag("SetupCommandOutput"),
  iteration: Schema.Number,
  output: Schema.String
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Check command output event
 */
export class CheckCommandOutput extends Schema.Class<CheckCommandOutput>("CheckCommandOutput")({
  _tag: Schema.tag("CheckCommandOutput"),
  iteration: Schema.Number,
  output: Schema.String
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Loop approved event - implementation was approved by reviewer
 */
export class LoopApproved extends Schema.Class<LoopApproved>("LoopApproved")({
  _tag: Schema.tag("LoopApproved"),
  iteration: Schema.Number
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId;
  [LoopTerminalEventTypeId]: LoopTerminalEventTypeId = LoopTerminalEventTypeId
}

/**
 * Loop spec issue event - a specification issue was detected
 */
export class LoopSpecIssue extends Schema.Class<LoopSpecIssue>("LoopSpecIssue")({
  _tag: Schema.tag("LoopSpecIssue"),
  iteration: Schema.Number,
  content: Schema.String,
  filename: Schema.String
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId;
  [LoopTerminalEventTypeId]: LoopTerminalEventTypeId = LoopTerminalEventTypeId
}

/**
 * Loop max iterations event - max iterations reached without approval
 */
export class LoopMaxIterations extends Schema.Class<LoopMaxIterations>("LoopMaxIterations")({
  _tag: Schema.tag("LoopMaxIterations"),
  iteration: Schema.Number,
  maxIterations: Schema.Number
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId;
  [LoopTerminalEventTypeId]: LoopTerminalEventTypeId = LoopTerminalEventTypeId
}

/**
 * Commit performed event - auto-commit succeeded after implementing phase
 */
export class CommitPerformed extends Schema.Class<CommitPerformed>("CommitPerformed")({
  _tag: Schema.tag("CommitPerformed"),
  iteration: Schema.Number,
  commitHash: Schema.String,
  message: Schema.String
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Commit failed event - auto-commit failed after implementing phase
 */
export class CommitFailed extends Schema.Class<CommitFailed>("CommitFailed")({
  _tag: Schema.tag("CommitFailed"),
  iteration: Schema.Number,
  message: Schema.String
}) {
  [LoopPhaseEventTypeId]: LoopPhaseEventTypeId = LoopPhaseEventTypeId
}

/**
 * Union of all loop phase events
 */
export type LoopPhaseEvent =
  | IterationStart
  | PlanningStart
  | ImplementingStart
  | ReviewingStart
  | SetupCommandOutput
  | CheckCommandOutput
  | LoopApproved
  | LoopSpecIssue
  | LoopMaxIterations
  | CommitPerformed
  | CommitFailed

export type LoopTerminalEvent =
  | LoopApproved
  | LoopSpecIssue
  | LoopMaxIterations

export type LoopInfoEvent =
  | IterationStart
  | PlanningStart
  | ImplementingStart
  | ReviewingStart
  | SetupCommandOutput
  | CheckCommandOutput

export const isLoopPhaseEvent = (event: unknown): event is LoopPhaseEvent =>
  typeof event === "object" && event !== null && LoopPhaseEventTypeId in event

export const isLoopTerminalEvent = (event: unknown): event is LoopTerminalEvent =>
  typeof event === "object" && event !== null && LoopTerminalEventTypeId in event

/**
 * Union of all loop events (agent events, marker events, and phase events)
 */
export type LoopEvent = LlmAgentEvent | LlmMarkerEvent | LoopPhaseEvent
