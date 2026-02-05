import { Effect, Layer, ServiceMap, Data, Stream, Option, Queue, Schema } from "effect"
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
  Progress,
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
  CheckCommandOutput,
  LoopApproved,
  LoopSpecIssue,
  LoopMaxIterations,
  CommitPerformed,
  CommitFailed,
  type LoopEvent
} from "./LoopEvent.js"

/**
 * Error during loop execution
 */
export class LoopError extends Data.TaggedError("LoopError")<{
  readonly phase: "planning" | "implementing" | "reviewing"
  readonly message: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `Loop error in ${this.phase} phase: ${this.message}`
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
  readonly checkCommand?: string
  readonly commit?: boolean
}

/**
 * Loop service shape - returns a stream of LoopEvents
 */
export interface LoopServiceShape {
  readonly run: (opts: LoopRunOptions) => Stream.Stream<
    LoopEvent,
    LoopError | SessionError | StorageError,
    ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService
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
  PROGRESS: Progress
  DONE: Done
}> = {
  NOTE: (content) => new Note({ content }),
  SPEC_ISSUE: (content) => new SpecIssue({ content }),
  PROGRESS: (content) => new Progress({ content }),
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

/**
 * Run a check command and capture its output.
 * This function NEVER fails - it always returns output (success or error message).
 */
const runCheckCommand = (command: string, cwd: string): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const cmd = ChildProcess.make({ cwd, shell: true })`${command}`
    const handle = yield* ChildProcess.spawn(cmd)
    const output = yield* Stream.mkString(Stream.decodeText(handle.all))
    const exitCode = yield* handle.exitCode
    if (output.trim()) return output
    if (exitCode !== 0) return `Check command failed with exit code ${exitCode}.`
    return "Check command completed successfully with no output."
  }).pipe(
    Effect.scoped,
    Effect.catch((cause) =>
      Effect.succeed(`Check command failed: ${cause}`)
    )
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
        const addCmd = ChildProcess.make({ cwd, shell: true })`git add -A -- . ':!${specsPath}'`
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
 * Create the LoopService layer
 */
export const LoopServiceLayer = Layer.effect(
  LoopService,
  Effect.gen(function*() {
    const agent = yield* LlmAgent
    const storage = yield* StorageService

    return {
      run: (opts) =>
        Stream.callback<LoopEvent, LoopError | SessionError | StorageError, ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService>((queue) => {
          /**
           * Helper to run a phase stream, emit events to the queue, and return the terminal marker.
           * Captures `queue` from the Stream.callback closure.
           */
          const runPhaseAndEmit = <TMarker, TEnd extends Schema.Top & { readonly DecodingServices: never }>(
            phaseStream: Stream.Stream<LlmAgentEvent | TMarker, LlmSessionError>,
            phase: "planning" | "implementing" | "reviewing",
            terminalSchema: TEnd
          ): Effect.Effect<Schema.Schema.Type<TEnd>, LoopError | SessionError, SessionService> =>
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
                Stream.runLast,
                Effect.catchTag("LlmSessionError", (err) =>
                  Effect.fail(new LoopError({ phase, message: err.message, cause: err }))
                )
              )

              if (Option.isNone(last) || !isLlmMarkerEvent(last.value) || !Schema.is(terminalSchema)(last.value)) {
                return yield* new LoopError({
                  phase,
                  message: `Non-terminal marker received from ${phase} agent`
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

            // State for code review
            let codeReview: Option.Option<string> = Option.none()

            for (let iteration = 1; iteration <= maxIterations; iteration++) {
              yield* Queue.offer(queue, new IterationStart({ iteration, maxIterations }))

              // Planning phase
              yield* Queue.offer(queue, new PlanningStart({ iteration }))
              const tempPlanPath = yield* session.getTempPlanPath()

              const planningSystemPrompt = planningPrompt({
                specsPath: opts.specsPath,
                focus: opts.focus,
                planPath: tempPlanPath,
                codeReview: Option.isSome(codeReview) ? codeReview.value : undefined
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

              // Implementation phase (with Progress inner loop)
              let implementationDone = false

              while (!implementationDone) {
                yield* Queue.offer(queue, new ImplementingStart({ iteration }))

                const checkOutput = yield* runCheckCommand(opts.checkCommand ?? "pnpm check && pnpm test", opts.cwd)
                yield* Queue.offer(queue, new CheckCommandOutput({ iteration, output: checkOutput }))

                const implementingSystemPrompt = implementingPrompt({
                  specsPath: opts.specsPath,
                  planPath: sessionPath,
                  sessionPath,
                  checkOutput
                })

                const implEvents = agent.spawn({
                  prompt: `Please implement the tasks from the plan at ${sessionPath}`,
                  systemPrompt: implementingSystemPrompt,
                  cwd: opts.cwd,
                  dangerouslySkipPermissions: true
                })

                const implMarkerStream = extractMarkers(implEvents, implementingMarkerConfig)

                const implTerminal = yield* runPhaseAndEmit(
                  implMarkerStream,
                  "implementing",
                  Schema.Union([SpecIssue, Progress, Done])
                )

                // Auto-commit if enabled (after Progress or Done)
                if (opts.commit && (implTerminal._tag === "Progress" || implTerminal._tag === "Done")) {
                  const commitMessage = (implTerminal as Progress | Done).content
                  const commitResult = yield* performAutoCommit(commitMessage, opts.cwd, iteration, opts.specsPath)
                  if (commitResult !== null) {
                    yield* Queue.offer(queue, commitResult)
                  }
                }

                switch (implTerminal._tag) {
                  case "SpecIssue": {
                    const specContent = (implTerminal as SpecIssue).content
                    const filename = yield* storage.writeSpecIssue(specContent)
                    yield* Queue.offer(queue, new LoopSpecIssue({ iteration, content: specContent, filename }))
                    yield* Queue.end(queue)
                    return
                  }
                  case "Progress":
                    continue
                  case "Done":
                    implementationDone = true
                }
              }

              // Reviewing phase
              yield* Queue.offer(queue, new ReviewingStart({ iteration }))

              const reviewCheckOutput = yield* runCheckCommand(opts.checkCommand ?? "pnpm check && pnpm test", opts.cwd)
              yield* Queue.offer(queue, new CheckCommandOutput({ iteration, output: reviewCheckOutput }))

              const reviewingSystemPrompt = reviewingPrompt({
                specsPath: opts.specsPath,
                sessionPath,
                reviewPath,
                checkOutput: reviewCheckOutput,
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
                  if (Option.isSome(review)) {
                    codeReview = review
                  } else {
                    yield* session.writeReview((reviewTerminal as RequestChanges).content)
                    codeReview = Option.some((reviewTerminal as RequestChanges).content)
                  }
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
