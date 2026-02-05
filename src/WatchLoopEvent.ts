import { Schema } from "effect"

export const WatchLoopEventTypeId: unique symbol = Symbol.for("WatchLoopEvent")
export type WatchLoopEventTypeId = typeof WatchLoopEventTypeId

export class WatchBacklogEmpty extends Schema.Class<WatchBacklogEmpty>("WatchBacklogEmpty")({
  _tag: Schema.tag("WatchBacklogEmpty")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchChangeDetected extends Schema.Class<WatchChangeDetected>("WatchChangeDetected")({
  _tag: Schema.tag("WatchChangeDetected")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchDebounceComplete extends Schema.Class<WatchDebounceComplete>("WatchDebounceComplete")({
  _tag: Schema.tag("WatchDebounceComplete")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchProcessingItem extends Schema.Class<WatchProcessingItem>("WatchProcessingItem")({
  _tag: Schema.tag("WatchProcessingItem"),
  filename: Schema.String
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchItemCompleted extends Schema.Class<WatchItemCompleted>("WatchItemCompleted")({
  _tag: Schema.tag("WatchItemCompleted"),
  filename: Schema.String
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchSpecIssueWaiting extends Schema.Class<WatchSpecIssueWaiting>("WatchSpecIssueWaiting")({
  _tag: Schema.tag("WatchSpecIssueWaiting")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchAuditStarted extends Schema.Class<WatchAuditStarted>("WatchAuditStarted")({
  _tag: Schema.tag("WatchAuditStarted")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchAuditEnded extends Schema.Class<WatchAuditEnded>("WatchAuditEnded")({
  _tag: Schema.tag("WatchAuditEnded")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchAuditInterrupted extends Schema.Class<WatchAuditInterrupted>("WatchAuditInterrupted")({
  _tag: Schema.tag("WatchAuditInterrupted")
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export class WatchTbdItemFound extends Schema.Class<WatchTbdItemFound>("WatchTbdItemFound")({
  _tag: Schema.tag("WatchTbdItemFound"),
  content: Schema.String,
  filename: Schema.String
}) {
  [WatchLoopEventTypeId]: WatchLoopEventTypeId = WatchLoopEventTypeId
}

export type WatchLoopEvent =
  | WatchBacklogEmpty
  | WatchChangeDetected
  | WatchDebounceComplete
  | WatchProcessingItem
  | WatchItemCompleted
  | WatchSpecIssueWaiting
  | WatchAuditStarted
  | WatchAuditEnded
  | WatchAuditInterrupted
  | WatchTbdItemFound

export const isWatchLoopEvent = (event: unknown): event is WatchLoopEvent =>
  typeof event === "object" && event !== null && WatchLoopEventTypeId in event
