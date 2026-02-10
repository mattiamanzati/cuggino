import { Effect, Layer, ServiceMap, Data, Stream, Option, Queue, Schema, FileSystem } from "effect"
import * as Uuid from "uuid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { LlmAgent } from "./LlmAgent.js"
import { SessionService, SessionServiceMap, SessionError, SessionKey } from "./SessionService.js"
import { StorageService, StorageError } from "./StorageService.js"
import { planningPrompt, implementingPrompt, reviewingPrompt } from "./AgentPrompts.js"
import { extractMarkers, type MarkerExtractorConfig } from "./extractMarkers.js"
import {
  Note,
  SpecIssue,
  Done,
  Approved,
  RequestChanges,
  PlanComplete,
  isLlmMarkerEvent
} from "./LlmMarkerEvent.js"
import type { LlmAgentEvent, LlmSessionError } from "./LlmAgentEvent.js"
import {
  IterationStart,
  PlanningStart,
  ImplementingStart,
  ReviewingStart,
  SetupCommandStarting,
  CheckCommandStarting,
  SetupCommandOutput,
  CheckCommandOutput,
  LoopApproved,
  LoopSpecIssue,
  LoopMaxIterations,
  CommitPerformed,
  CommitFailed,
  PushPerformed,
  PushFailed,
  type LoopEvent
} from "./LoopEvent.js"

/**
 * Error during loop execution
 */
export class LoopError extends Data.TaggedError("LoopError")<{
  readonly phase: "planning" | "implementing" | "reviewing"
  readonly detail: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `Loop error in ${this.phase} phase: ${this.detail}`
  }
}

/**
 * Options for running the loop
 */
export interface LoopRunOptions {
  readonly focus: string
  readonly specsPath: string
  readonly cwd: string
  readonly maxIterations?: number
  readonly setupCommand?: string
  readonly checkCommand?: string
  readonly commit?: boolean
  readonly push?: string
}

/**
 * Loop service shape - returns a stream of LoopEvents
 */
export interface LoopServiceShape {
  readonly run: (opts: LoopRunOptions) => Stream.Stream<
    LoopEvent,
    LoopError | LlmSessionError | SessionError | StorageError,
    ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService | FileSystem.FileSystem
  >
}

/**
 * Loop service for orchestrating the autonomous coder loop
 */
export class LoopService extends ServiceMap.Service<LoopService, LoopServiceShape>()("LoopService") {}

// Marker configs for each phase
const planningMarkerConfig: MarkerExtractorConfig<{
  SPEC_ISSUE: SpecIssue
  PLAN_COMPLETE: PlanComplete
}> = {
  SPEC_ISSUE: (content) => new SpecIssue({ content }),
  PLAN_COMPLETE: (content) => new PlanComplete({ content })
}

const implementingMarkerConfig: MarkerExtractorConfig<{
  NOTE: Note
  SPEC_ISSUE: SpecIssue
  DONE: Done
}> = {
  NOTE: (content) => new Note({ content }),
  SPEC_ISSUE: (content) => new SpecIssue({ content }),
  DONE: (content) => new Done({ content })
}

const reviewingMarkerConfig: MarkerExtractorConfig<{
  SPEC_ISSUE: SpecIssue
  APPROVED: Approved
  REQUEST_CHANGES: RequestChanges
}> = {
  SPEC_ISSUE: (content) => new SpecIssue({ content }),
  APPROVED: (content) => new Approved({ content }),
  REQUEST_CHANGES: (content) => new RequestChanges({ content })
}

const hasCommand = (cmd: string | undefined): cmd is string =>
  cmd !== undefined && cmd.trim() !== ""

/**
 * Run a shell command and stream its output directly to a file.
 * This function NEVER fails - it always returns an exit code (-1 on error).
 */
const runShellCommandToFile = (command: string, cwd: string, filePath: string): Effect.Effect<number, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const cmd = ChildProcess.make({ cwd, shell: true })`${command}`
    const handle = yield* ChildProcess.spawn(cmd)
    yield* Stream.run(handle.all, fs.sink(filePath))
    return yield* handle.exitCode
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed(-1))
  )

/**
 * Run git auto-commit: stage all, check for changes, commit, return event.
 * Returns null if there are no staged changes. Never fails the outer effect.
 */
const performAutoCommit = (
  message: string,
  cwd: string,
  iteration: number,
  specsPath: string
): Effect.Effect<CommitPerformed | CommitFailed | null, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    // Stage all changes except the specs folder
    yield* Effect.scoped(
      Effect.gen(function*() {
        const addCmd = ChildProcess.make("git", ["add", "-A", "--", ".", `:!${specsPath}`, `:!.cuggino`], { cwd })
        yield* ChildProcess.string(addCmd)
      })
    )

    // Check if there are staged changes (exit code 0 = no changes, non-zero = has changes)
    const hasStagedChanges = yield* Effect.scoped(
      Effect.gen(function*() {
        const diffCmd = ChildProcess.make({ cwd, shell: true })`git diff --cached --quiet`
        const handle = yield* ChildProcess.spawn(diffCmd)
        yield* Stream.runDrain(handle.stdout).pipe(Effect.ignore)
        yield* Stream.runDrain(handle.stderr).pipe(Effect.ignore)
        const exitCode = yield* handle.exitCode
        return exitCode !== 0
      })
    ).pipe(Effect.catch(() => Effect.succeed(false)))

    if (!hasStagedChanges) {
      return null
    }

    // Commit with the message
    yield* Effect.scoped(
      Effect.gen(function*() {
        const commitCmd = ChildProcess.make("git", ["commit", "-m", message], { cwd })
        yield* ChildProcess.string(commitCmd)
      })
    )

    // Get short hash
    const hash = yield* Effect.scoped(
      Effect.gen(function*() {
        const hashCmd = ChildProcess.make({ cwd, shell: true })`git rev-parse --short HEAD`
        return (yield* ChildProcess.string(hashCmd)).trim()
      })
    )

    return new CommitPerformed({ iteration, commitHash: hash, message })
  }).pipe(
    Effect.catch((cause) =>
      Effect.succeed(new CommitFailed({ iteration, message: `${cause}` }))
    )
  )

/**
 * Run git push to the specified remote/branch. Never fails the outer effect.
 */
const performAutoPush = (
  pushRef: string,
  cwd: string,
  iteration: number,
  commitHash: string
): Effect.Effect<PushPerformed | PushFailed, never, ChildProcessSpawner.ChildProcessSpawner> => {
  const slashIndex = pushRef.indexOf("/")
  const remote = slashIndex >= 0 ? pushRef.slice(0, slashIndex) : pushRef
  const branch = slashIndex >= 0 ? pushRef.slice(slashIndex + 1) : "main"

  return Effect.scoped(
    Effect.gen(function*() {
      const cmd = ChildProcess.make("git", ["push", remote, `HEAD:${branch}`], { cwd })
      yield* ChildProcess.string(cmd)
      return new PushPerformed({ iteration, commitHash, remote: pushRef })
    })
  ).pipe(
    Effect.catch((cause) =>
      Effect.succeed(new PushFailed({ iteration, message: `${cause}` }))
    )
  )
}

/**
 * Create the LoopService layer
 */
export const LoopServiceLayer = Layer.effect(
  LoopService,
  Effect.gen(function*() {
    const agent = yield* LlmAgent
    const storage = yield* StorageService

    return {
      run: (opts) =>
        Stream.callback<LoopEvent, LoopError | LlmSessionError | SessionError | StorageError, ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService | FileSystem.FileSystem>((queue) => {
          /**
           * Helper to run a phase stream, emit events to the queue, and return the terminal marker.
           * Captures `queue` from the Stream.callback closure.
           */
          const runPhaseAndEmit = <TMarker, TEnd extends Schema.Top & { readonly DecodingServices: never }>(
            phaseStream: Stream.Stream<LlmAgentEvent | TMarker, LlmSessionError>,
            phase: "planning" | "implementing" | "reviewing",
            terminalSchema: TEnd
          ): Effect.Effect<Schema.Schema.Type<TEnd>, LoopError | LlmSessionError | SessionError, SessionService> =>
            Effect.gen(function*() {
              const session = yield* SessionService
              const last = yield* phaseStream.pipe(
                Stream.takeUntil(Schema.is(terminalSchema)),
                Stream.tap((event) =>
                  Effect.gen(function*() {
                    yield* Queue.offer(queue, event as LoopEvent)
                    if (isLlmMarkerEvent(event)) {
                      yield* session.appendMarker(event)
                    }
                  })
                ),
                Stream.runLast
              )

              if (Option.isNone(last)) {
                return yield* new LoopError({
                  phase,
                  detail: `Agent stream ended without emitting any marker`
                })
              }

              if (!isLlmMarkerEvent(last.value)) {
                const lastValue = last.value as Record<string, unknown>
                const tag = "_tag" in lastValue ? String(lastValue._tag) : "unknown"
                return yield* new LoopError({
                  phase,
                  detail: `Agent stream ended without emitting a marker (last event: ${tag})`
                })
              }

              if (!Schema.is(terminalSchema)(last.value)) {
                return yield* new LoopError({
                  phase,
                  detail: `Non-terminal marker received from ${phase} agent (got: ${last.value._tag})`
                })
              }

              return last.value as TMarker
            })

          const key = new SessionKey({ cwd: opts.cwd, sessionId: Uuid.v7() })

          return Effect.gen(function*() {
            const session = yield* SessionService
            const maxIterations = opts.maxIterations ?? 10

            // Get paths
            const sessionPath = yield* session.getSessionPath()
            const reviewPath = yield* session.getReviewPath()

            // Capture initial commit hash if --commit is enabled
            let initialCommitHash: string | null = null
            if (opts.commit) {
              initialCommitHash = yield* Effect.scoped(
                Effect.gen(function*() {
                  const cmd = ChildProcess.make({ cwd: opts.cwd, shell: true })`git rev-parse HEAD`
                  return (yield* ChildProcess.string(cmd)).trim()
                })
              ).pipe(Effect.catch(() => Effect.succeed(null)))
            }

            // State for review file path
            let reviewFilePath: Option.Option<string> = Option.none()

            for (let iteration = 1; iteration <= maxIterations; iteration++) {
              yield* Queue.offer(queue, new IterationStart({ iteration, maxIterations }))

              // Planning phase
              yield* Queue.offer(queue, new PlanningStart({ iteration }))
              const tempPlanPath = yield* session.getTempPlanPath()

              const planningSystemPrompt = planningPrompt({
                specsPath: opts.specsPath,
                cugginoPath: storage.rootDir,
                focus: opts.focus,
                planPath: tempPlanPath,
                reviewPath: Option.isSome(reviewFilePath) ? reviewFilePath.value : undefined,
                previousPlanPath: Option.isSome(reviewFilePath) ? sessionPath : undefined
              })

              const planEvents = agent.spawn({
                prompt: `Please create an implementation plan for: ${opts.focus}. Write the plan to ${tempPlanPath}`,
                systemPrompt: planningSystemPrompt,
                cwd: opts.cwd,
                dangerouslySkipPermissions: true
              })

              const planMarkerStream = extractMarkers(planEvents, planningMarkerConfig)

              const planTerminal = yield* runPhaseAndEmit(
                planMarkerStream,
                "planning",
                Schema.Union([SpecIssue, PlanComplete])
              )

              if (planTerminal._tag === "SpecIssue") {
                const specContent = (planTerminal as SpecIssue).content
                const filename = yield* storage.writeSpecIssue(specContent)
                yield* Queue.offer(queue, new LoopSpecIssue({ iteration, content: specContent, filename }))
                yield* Queue.end(queue)
                return
              }

              // Commit temp plan
              yield* session.commitTempPlan()

              // Setup command (after planning, before implementation)
              if (hasCommand(opts.setupCommand)) {
                yield* Queue.offer(queue, new SetupCommandStarting({ iteration }))
                const setupOutputPath = yield* session.getSetupOutputPath()
                const setupExitCode = yield* runShellCommandToFile(opts.setupCommand, opts.cwd, setupOutputPath)
                yield* Queue.offer(queue, new SetupCommandOutput({ iteration, filePath: setupOutputPath, exitCode: setupExitCode }))
                if (setupExitCode !== 0) {
                  return yield* new LoopError({
                    phase: "planning",
                    detail: `Setup command failed with exit code ${setupExitCode}`
                  })
                }
              }

              // Implementation phase
              yield* Queue.offer(queue, new ImplementingStart({ iteration }))

              let checkOutputPath: string | undefined
              let checkExitCode: number | undefined
              if (hasCommand(opts.checkCommand)) {
                yield* Queue.offer(queue, new CheckCommandStarting({ iteration }))
                checkOutputPath = yield* session.getCheckOutputPath()
                checkExitCode = yield* runShellCommandToFile(opts.checkCommand, opts.cwd, checkOutputPath)
                yield* Queue.offer(queue, new CheckCommandOutput({ iteration, filePath: checkOutputPath, exitCode: checkExitCode }))
              }

              const implementingSystemPrompt = implementingPrompt({
                specsPath: opts.specsPath,
                cugginoPath: storage.rootDir,
                planPath: sessionPath,
                sessionPath,
                checkOutputPath,
                checkExitCode
              })

              const implEvents = agent.spawn({
                prompt: `Please implement one task from the plan at ${sessionPath}`,
                systemPrompt: implementingSystemPrompt,
                cwd: opts.cwd,
                dangerouslySkipPermissions: true
              })

              const implMarkerStream = extractMarkers(implEvents, implementingMarkerConfig)

              const implTerminal = yield* runPhaseAndEmit(
                implMarkerStream,
                "implementing",
                Schema.Union([SpecIssue, Done])
              )

              if (implTerminal._tag === "SpecIssue") {
                const specContent = (implTerminal as SpecIssue).content
                const filename = yield* storage.writeSpecIssue(specContent)
                yield* Queue.offer(queue, new LoopSpecIssue({ iteration, content: specContent, filename }))
                yield* Queue.end(queue)
                return
              }

              // Auto-commit if enabled (after Done)
              if (opts.commit) {
                const commitMessage = (implTerminal as Done).content
                const commitResult = yield* performAutoCommit(commitMessage, opts.cwd, iteration, opts.specsPath)
                if (commitResult !== null) {
                  yield* Queue.offer(queue, commitResult)
                  // Auto-push if enabled and commit succeeded
                  if (commitResult._tag === "CommitPerformed" && opts.push && opts.push.trim() !== "") {
                    const pushResult = yield* performAutoPush(opts.push, opts.cwd, iteration, commitResult.commitHash)
                    yield* Queue.offer(queue, pushResult)
                  }
                }
              }

              // Reviewing phase - clear stale review from previous iteration
              yield* session.clearReview()
              yield* Queue.offer(queue, new ReviewingStart({ iteration }))

              let reviewCheckOutputPath: string | undefined
              let reviewCheckExitCode: number | undefined
              if (hasCommand(opts.checkCommand)) {
                yield* Queue.offer(queue, new CheckCommandStarting({ iteration }))
                reviewCheckOutputPath = yield* session.getCheckOutputPath()
                reviewCheckExitCode = yield* runShellCommandToFile(opts.checkCommand, opts.cwd, reviewCheckOutputPath)
                yield* Queue.offer(queue, new CheckCommandOutput({ iteration, filePath: reviewCheckOutputPath, exitCode: reviewCheckExitCode }))
              }

              const reviewingSystemPrompt = reviewingPrompt({
                specsPath: opts.specsPath,
                cugginoPath: storage.rootDir,
                sessionPath,
                reviewPath,
                checkOutputPath: reviewCheckOutputPath,
                checkExitCode: reviewCheckExitCode,
                initialCommitHash: initialCommitHash ?? undefined
              })

              const reviewEvents = agent.spawn({
                prompt: `Please review the implementation against the specifications in ${opts.specsPath}`,
                systemPrompt: reviewingSystemPrompt,
                cwd: opts.cwd,
                dangerouslySkipPermissions: true
              })

              const reviewMarkerStream = extractMarkers(reviewEvents, reviewingMarkerConfig)

              const reviewTerminal = yield* runPhaseAndEmit(
                reviewMarkerStream,
                "reviewing",
                Schema.Union([SpecIssue, Approved, RequestChanges])
              )

              switch (reviewTerminal._tag) {
                case "SpecIssue": {
                  const specContent = (reviewTerminal as SpecIssue).content
                  const filename = yield* storage.writeSpecIssue(specContent)
                  yield* Queue.offer(queue, new LoopSpecIssue({ iteration, content: specContent, filename }))
                  yield* Queue.end(queue)
                  return
                }
                case "Approved": {
                  yield* Queue.offer(queue, new LoopApproved({ iteration }))
                  yield* Queue.end(queue)
                  return
                }
                case "RequestChanges": {
                  const review = yield* session.readReview()
                  if (Option.isNone(review)) {
                    yield* session.writeReview((reviewTerminal as RequestChanges).content)
                  }
                  reviewFilePath = Option.some(reviewPath)
                }
              }
            }

            yield* Queue.offer(queue, new LoopMaxIterations({ iteration: maxIterations, maxIterations }))
            yield* Queue.end(queue)
          }).pipe(
            Effect.provide(SessionServiceMap.get(key))
          )
        })
    }
  })
)
