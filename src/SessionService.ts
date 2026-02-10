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
 * Format a marker event as markdown text
 */
const formatMarker = (marker: LlmMarkerEvent): string => {
  switch (marker._tag) {
    case "Note":
      return `\n<NOTE>\n${marker.content}\n</NOTE>\n`
    case "SpecIssue":
      return `\n<SPEC_ISSUE>\n${marker.content}\n</SPEC_ISSUE>\n`
    case "Done":
      return `\n<DONE>\n${marker.content}\n</DONE>\n`
    case "Approved":
      return `\n<APPROVED>\n${marker.content}\n</APPROVED>\n`
    case "RequestChanges":
      return `\n<REQUEST_CHANGES>\n${marker.content}\n</REQUEST_CHANGES>\n`
    case "PlanComplete":
      return `\n<PLAN_COMPLETE>\n${marker.content}\n</PLAN_COMPLETE>\n`
    case "ToBeDiscussed":
      return `\n<TO_BE_DISCUSSED>\n${marker.content}\n</TO_BE_DISCUSSED>\n`
  }
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
            const content = yield* fs.readFileString(sessionPath)
            yield* fs.writeFileString(sessionPath, content + formatMarker(marker))
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
