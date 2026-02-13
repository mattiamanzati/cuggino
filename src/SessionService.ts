import { Effect, Layer, Option, ServiceMap, Data, FileSystem, Path, LayerMap } from "effect"
import type { LlmMarkerEvent } from "./LlmMarkerEvent.js"
import { StorageService } from "./StorageService.js"

/**
 * Error when session operations fail
 */
export class SessionError extends Data.TaggedError("SessionError")<{
  readonly operation: string
  readonly sessionId?: string
  readonly cause?: unknown
}> {
  override get message(): string {
    const session = this.sessionId ? ` (session: ${this.sessionId})` : ""
    return `Session ${this.operation} failed${session}`
  }
}

/**
 * Composite key for SessionServiceMap containing both cwd and sessionId
 */
export class SessionKey extends Data.Class<{
  readonly cwd: string
  readonly sessionId: string
}> {}

/**
 * Session service shape
 */
export interface SessionServiceShape {
  /** The session ID */
  readonly sessionId: string

  /** Append marker content to session file */
  readonly appendMarker: (marker: LlmMarkerEvent) => Effect.Effect<void, SessionError>

  /** Write code review file */
  readonly writeReview: (review: string) => Effect.Effect<void, SessionError>

  /** Clear the review file if it exists */
  readonly clearReview: () => Effect.Effect<void, SessionError>

  /** Read the code review (if exists) */
  readonly readReview: () => Effect.Effect<Option.Option<string>, SessionError>

  /** Get the session file path */
  readonly getSessionPath: () => Effect.Effect<string, SessionError>

  /** Get the review file path */
  readonly getReviewPath: () => Effect.Effect<string, SessionError>

  /** Get a temporary plan file path (for planning agent to write to) */
  readonly getTempPlanPath: () => Effect.Effect<string, SessionError>

  /** Get the check output file path */
  readonly getCheckOutputPath: () => Effect.Effect<string, SessionError>

  /** Get the setup output file path */
  readonly getSetupOutputPath: () => Effect.Effect<string, SessionError>

  /** Read from temp plan file and move content to session file, then delete temp */
  readonly commitTempPlan: () => Effect.Effect<void, SessionError>
}

/**
 * Session service for managing session files in .cuggino/wip/ folder
 */
export class SessionService extends ServiceMap.Service<SessionService, SessionServiceShape>()("SessionService") {}

/**
 * Map marker _tag to its uppercase label
 */
const markerLabel: Record<LlmMarkerEvent["_tag"], string> = {
  Note: "NOTE",
  SpecIssue: "SPEC_ISSUE",
  Done: "DONE",
  NoMoreWork: "NO_MORE_WORK",
  Approved: "APPROVED",
  RequestChanges: "REQUEST_CHANGES",
  PlanComplete: "PLAN_COMPLETE",
  ToBeDiscussed: "TO_BE_DISCUSSED"
}

/**
 * Format a timestamp as YYYY-MM-DD HH:MM:SS
 */
const formatTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Format a marker event as a markdown heading with timestamp
 */
const formatMarker = (marker: LlmMarkerEvent, now: Date): string => {
  const label = markerLabel[marker._tag]
  const timestamp = formatTimestamp(now)
  return `\n## ${timestamp} (${label})\n\n${marker.content}\n`
}

/**
 * SessionServiceMap - keyed layer map where key is SessionKey (cwd + sessionId)
 */
export class SessionServiceMap extends LayerMap.Service<SessionServiceMap>()("SessionServiceMap", {
  lookup: (key: SessionKey) => Layer.effect(
    SessionService,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const storage = yield* StorageService

      const sessionId = key.sessionId

      // Compute paths using StorageService.wipDir
      const sessionPath = path.join(storage.wipDir, `${sessionId}.md`)
      const reviewPath = path.join(storage.wipDir, `${sessionId}.review.md`)
      const tempPlanPath = path.join(storage.wipDir, `${sessionId}.plan.md`)
      const checkOutputPath = path.join(storage.wipDir, `${sessionId}.check.txt`)
      const setupOutputPath = path.join(storage.wipDir, `${sessionId}.setup.txt`)

      // Create the session file
      yield* fs.writeFileString(sessionPath, "")

      // Register finalizer to clean up all session files
      yield* Effect.addFinalizer(() =>
        Effect.gen(function*() {
          if (yield* fs.exists(sessionPath)) yield* fs.remove(sessionPath)
          if (yield* fs.exists(reviewPath)) yield* fs.remove(reviewPath)
          if (yield* fs.exists(tempPlanPath)) yield* fs.remove(tempPlanPath)
          if (yield* fs.exists(checkOutputPath)) yield* fs.remove(checkOutputPath)
          if (yield* fs.exists(setupOutputPath)) yield* fs.remove(setupOutputPath)
        }).pipe(Effect.ignore)
      )

      return {
        sessionId,

        appendMarker: (marker: LlmMarkerEvent) =>
          Effect.gen(function*() {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
            const content = yield* fs.readFileString(sessionPath)
            yield* fs.writeFileString(sessionPath, content + formatMarker(marker, new Date(now)))
          }).pipe(
            Effect.catch((cause) =>
              cause instanceof SessionError
                ? Effect.fail(cause)
                : Effect.fail(new SessionError({ operation: "appendMarker", sessionId, cause }))
            )
          ),

        writeReview: (review: string) =>
          fs.writeFileString(reviewPath, review).pipe(
            Effect.catch((cause) =>
              cause instanceof SessionError
                ? Effect.fail(cause)
                : Effect.fail(new SessionError({ operation: "writeReview", sessionId, cause }))
            )
          ),

        clearReview: () =>
          Effect.gen(function*() {
            if (yield* fs.exists(reviewPath)) {
              yield* fs.remove(reviewPath)
            }
          }).pipe(
            Effect.catch((cause) =>
              cause instanceof SessionError
                ? Effect.fail(cause)
                : Effect.fail(new SessionError({ operation: "clearReview", sessionId, cause }))
            )
          ),

        readReview: () =>
          Effect.gen(function*() {
            const reviewExists = yield* fs.exists(reviewPath)
            if (!reviewExists) {
              return Option.none()
            }
            const content = yield* fs.readFileString(reviewPath)
            return Option.some(content)
          }).pipe(
            Effect.catch((cause) =>
              cause instanceof SessionError
                ? Effect.fail(cause)
                : Effect.fail(new SessionError({ operation: "readReview", sessionId, cause }))
            )
          ),

        getSessionPath: () => Effect.succeed(sessionPath),
        getReviewPath: () => Effect.succeed(reviewPath),
        getTempPlanPath: () => Effect.succeed(tempPlanPath),
        getCheckOutputPath: () => Effect.succeed(checkOutputPath),
        getSetupOutputPath: () => Effect.succeed(setupOutputPath),

        commitTempPlan: () =>
          Effect.gen(function*() {
            const plan = yield* fs.readFileString(tempPlanPath)
            yield* fs.writeFileString(sessionPath, plan + "\n\n# Progress Log\n")
            yield* fs.remove(tempPlanPath)
          }).pipe(
            Effect.catch((cause) =>
              cause instanceof SessionError
                ? Effect.fail(cause)
                : Effect.fail(new SessionError({ operation: "commitTempPlan", sessionId, cause }))
            )
          )
      }
    }).pipe(
      Effect.catch((cause) =>
        cause instanceof SessionError
          ? Effect.fail(cause)
          : Effect.fail(new SessionError({ operation: "init", sessionId: key.sessionId, cause }))
      )
    )
  )
}) {}
