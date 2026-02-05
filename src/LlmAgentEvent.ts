import { Schema } from "effect"

export const LlmAgentEventTypeId: unique symbol = Symbol.for("LlmAgentEvent")
export type LlmAgentEventTypeId = typeof LlmAgentEventTypeId

/**
 * System initialization or status message
 */
export class SystemMessage extends Schema.Class<SystemMessage>("SystemMessage")({
  _tag: Schema.tag("SystemMessage"),
  text: Schema.String
}) {
  [LlmAgentEventTypeId]: LlmAgentEventTypeId = LlmAgentEventTypeId
}

/**
 * Text output from the LLM agent
 */
export class AgentMessage extends Schema.Class<AgentMessage>("AgentMessage")({
  _tag: Schema.tag("AgentMessage"),
  text: Schema.String
}) {
  [LlmAgentEventTypeId]: LlmAgentEventTypeId = LlmAgentEventTypeId
}

/**
 * User input context (e.g., tool result acknowledgment)
 */
export class UserMessage extends Schema.Class<UserMessage>("UserMessage")({
  _tag: Schema.tag("UserMessage"),
  text: Schema.String
}) {
  [LlmAgentEventTypeId]: LlmAgentEventTypeId = LlmAgentEventTypeId
}

/**
 * Agent requesting to execute a tool
 */
export class ToolCall extends Schema.Class<ToolCall>("ToolCall")({
  _tag: Schema.tag("ToolCall"),
  name: Schema.String,
  input: Schema.Unknown
}) {
  [LlmAgentEventTypeId]: LlmAgentEventTypeId = LlmAgentEventTypeId
}

/**
 * Result from tool execution
 */
export class ToolResult extends Schema.Class<ToolResult>("ToolResult")({
  _tag: Schema.tag("ToolResult"),
  name: Schema.String,
  output: Schema.String,
  isError: Schema.Boolean
}) {
  [LlmAgentEventTypeId]: LlmAgentEventTypeId = LlmAgentEventTypeId
}

/**
 * Error indicating the LLM session failed.
 * Note: This is used as the error type in streams, not as an event in the union.
 */
export class LlmSessionError extends Schema.Class<LlmSessionError>("LlmSessionError")({
  _tag: Schema.tag("LlmSessionError"),
  message: Schema.String
}) {}

/**
 * Activity heartbeat - indicates the agent is still working
 */
export class PingEvent extends Schema.Class<PingEvent>("PingEvent")({
  _tag: Schema.tag("PingEvent"),
  timestamp: Schema.DateTimeUtc
}) {
  [LlmAgentEventTypeId]: LlmAgentEventTypeId = LlmAgentEventTypeId
}

/**
 * Union of all LLM agent events
 */
export type LlmAgentEvent =
  | SystemMessage
  | AgentMessage
  | UserMessage
  | ToolCall
  | ToolResult
  | PingEvent

/**
 * Schema for encoding/decoding LlmAgentEvent
 */
export const LlmAgentEventSchema = Schema.Union([
  SystemMessage,
  AgentMessage,
  UserMessage,
  ToolCall,
  ToolResult,
  PingEvent
])

export const isLlmAgentEvent = (event: unknown): event is LlmAgentEvent =>
  typeof event === "object" && event !== null && LlmAgentEventTypeId in event
