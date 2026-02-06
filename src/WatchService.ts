import { Cause, Effect, Hash, Layer, ServiceMap, Data, Stream, FileSystem, Path, Queue, Fiber } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { LoopService } from "./LoopService.js"
import { LlmAgent, type LlmAgentShape } from "./LlmAgent.js"
import { StorageService, type StorageServiceShape } from "./StorageService.js"
import { SessionServiceMap } from "./SessionService.js"
import { isLoopTerminalEvent, type LoopEvent, type LoopTerminalEvent } from "./LoopEvent.js"
import { auditSystemPrompt, auditPrompt } from "./AgentPrompts.js"
import { ToBeDiscussed } from "./LlmMarkerEvent.js"
import { extractMarkers, type MarkerExtractorConfig } from "./extractMarkers.js"
import { NotificationService } from "./NotificationService.js"
import {
  WatchBacklogWaiting,
  WatchProcessingItem,
  WatchItemCompleted,
  WatchItemRetained,
  WatchSpecIssueWaiting,
  WatchAuditStarted,
  WatchAuditEnded,
  WatchAuditInterrupted,
  WatchTbdItemFound,
  type WatchLoopEvent
} from "./WatchLoopEvent.js"

export class WatchError extends Data.TaggedError("WatchError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface WatchRunOptions {
  readonly specsPath: string
  readonly maxIterations?: number
  readonly setupCommand?: string
  readonly checkCommand?: string
  readonly commit?: boolean
  readonly audit?: boolean
  readonly notify?: string
}

export type WatchEvent = LoopEvent | WatchLoopEvent

export interface WatchServiceShape {
  readonly run: (opts: WatchRunOptions) => Stream.Stream<
    WatchEvent,
    WatchError,
    ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService
  >
}

export class WatchService extends ServiceMap.Service<WatchService, WatchServiceShape>()("WatchService") {}

/**
 * List files in a directory sorted by filename, excluding hidden files.
 * Returns empty array if directory doesn't exist or can't be read.
 */
const listSorted = (fs: FileSystem.FileSystem, dir: string): Effect.Effect<Array<string>> =>
  Effect.gen(function*() {
    const files = yield* fs.readDirectory(dir)
    return files
      .filter((f) => !f.startsWith("."))
      .sort()
  }).pipe(
    Effect.catch(() => Effect.succeed([]))
  )

/**
 * Count visible (non-hidden) files in a directory.
 * Returns 0 if directory doesn't exist or can't be read.
 */
const countFiles = (fs: FileSystem.FileSystem, dir: string): Effect.Effect<number> =>
  fs.readDirectory(dir).pipe(
    Effect.map((files) => files.filter((f) => !f.startsWith(".")).length),
    Effect.catch(() => Effect.succeed(0))
  )

/**
 * Stream that tracks the number of visible files in a directory.
 * Emits the initial count immediately, then debounced updates on changes.
 * Consecutive identical counts are deduplicated.
 */
const watchFileCount = (fs: FileSystem.FileSystem, dir: string): Stream.Stream<number, WatchError> => {
  const initial = Stream.fromEffect(countFiles(fs, dir))
  const onChange = fs.watch(dir).pipe(
    Stream.debounce("30 seconds"),
    Stream.mapEffect(() => countFiles(fs, dir))
  )
  return Stream.concat(initial, onChange).pipe(
    Stream.changes,
    Stream.mapError((cause) => new WatchError({ message: `Watch failed on ${dir}`, cause }))
  )
}

const auditMarkerConfig: MarkerExtractorConfig<{
  TO_BE_DISCUSSED: ToBeDiscussed
}> = {
  TO_BE_DISCUSSED: (content) => new ToBeDiscussed({ content })
}

/**
 * Spawn the audit agent, extract markers, forward events to queue,
 * and persist ToBeDiscussed findings via StorageService.
 */
const runAuditAgent = (
  agent: LlmAgentShape,
  storage: StorageServiceShape,
  queue: Queue.Queue<WatchEvent, WatchError | Cause.Done<void>>,
  specsPath: string
): Effect.Effect<void, WatchError> =>
  Effect.gen(function*() {
    const auditOpts = { specsPath, tbdPath: storage.tbdDir }
    const rawStream = agent.spawn({
      cwd: storage.cwd,
      prompt: auditPrompt(auditOpts),
      systemPrompt: auditSystemPrompt(auditOpts),
      dangerouslySkipPermissions: true
    })

    const markerStream = extractMarkers(rawStream, auditMarkerConfig)

    yield* markerStream.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function*() {
          Queue.offerUnsafe(queue, event as WatchEvent)

          if (event instanceof ToBeDiscussed) {
            const filename = yield* storage.writeTbdItem(event.content)
            yield* Queue.offer(queue, new WatchTbdItemFound({ content: event.content, filename }))
          }
        })
      )
    )
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof WatchError
        ? cause
        : new WatchError({ message: "Audit agent failed", cause })
    )
  )

/**
 * Wrap an idle-state effect to optionally run the audit agent concurrently.
 * The audit fiber is interrupted when the idle effect completes.
 */
const withAuditDuringIdle = (
  idleEffect: Effect.Effect<void, WatchError>,
  audit: boolean,
  agent: LlmAgentShape,
  storage: StorageServiceShape,
  queue: Queue.Queue<WatchEvent, WatchError | Cause.Done<void>>,
  specsPath: string
): Effect.Effect<void, WatchError> => {
  if (!audit) return idleEffect

  return Effect.acquireUseRelease(
    // acquire: fork a child fiber that delays then runs the audit agent
    Effect.forkChild(
      Effect.sleep(1000).pipe(
        Effect.andThen(Queue.offer(queue, new WatchAuditStarted({}))),
        Effect.andThen(runAuditAgent(agent, storage, queue, specsPath)),
        Effect.tap(() => Queue.offer(queue, new WatchAuditEnded({}))),
        Effect.onInterrupt(() => Queue.offer(queue, new WatchAuditInterrupted({})))
      )
    ),
    // use: run the idle effect (folder watcher) immediately
    (_fiber) => idleEffect,
    // release: always interrupt — no-op if already finished
    (fiber) => Fiber.interrupt(fiber)
  )
}

/**
 * Create the WatchService layer
 */
export const WatchServiceLayer = Layer.effect(
  WatchService,
  Effect.gen(function*() {
    const loop = yield* LoopService
    const agent = yield* LlmAgent
    const storage = yield* StorageService
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const notification = yield* NotificationService

    return {
      run: (opts) =>
        Stream.callback<WatchEvent, WatchError, ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService>((queue) =>
          Effect.gen(function*() {
            while (true) {
              // Waiting phase: combine file count streams and wait until ready
              const combined = Stream.zipLatest(
                watchFileCount(fs, storage.specIssuesDir),
                watchFileCount(fs, storage.backlogDir)
              )

              const waitingPhase = Effect.gen(function*() {
                let prevState: "spec-issue" | "backlog-empty" | null = null

                yield* combined.pipe(
                  Stream.takeUntil(([specCount, backlogCount]) =>
                    specCount === 0 && backlogCount > 0
                  ),
                  Stream.runForEach(([specCount, backlogCount]) =>
                    Effect.gen(function*() {
                      if (specCount > 0) {
                        if (prevState !== "spec-issue") {
                          yield* Queue.offer(queue, new WatchSpecIssueWaiting({}))
                          if (opts.notify !== undefined && opts.notify !== "none") {
                            yield* notification.send({
                              title: notification.repoName,
                              body: "A spec issue needs to be resolved before continuing"
                            }).pipe(Effect.ignore)
                          }
                          prevState = "spec-issue"
                        }
                      } else if (backlogCount === 0) {
                        if (prevState !== "backlog-empty") {
                          yield* Queue.offer(queue, new WatchBacklogWaiting({}))
                          if (opts.notify !== undefined && opts.notify !== "none") {
                            yield* notification.send({
                              title: notification.repoName,
                              body: "Work is complete, waiting for you"
                            }).pipe(Effect.ignore)
                          }
                          prevState = "backlog-empty"
                        }
                      }
                      // specCount === 0 && backlogCount > 0: exit condition, handled by takeUntil
                    })
                  )
                )
              })

              yield* withAuditDuringIdle(
                waitingPhase,
                opts.audit ?? false,
                agent,
                storage,
                queue,
                opts.specsPath
              )

              // Processing phase: pick first backlog file
              const backlogFiles = yield* listSorted(fs, storage.backlogDir)
              if (backlogFiles.length === 0) continue

              const firstFile = backlogFiles[0]
              const filePath = pathService.join(storage.backlogDir, firstFile)

              yield* Queue.offer(queue, new WatchProcessingItem({ filename: firstFile }))

              // Read content and compute hash before running the loop
              const fileContent = yield* fs.readFileString(filePath)
              const originalHash = Hash.string(fileContent)

              // Run the coding loop, forwarding all events to the queue, and capture terminal event
              const terminalEvents: Array<LoopTerminalEvent> = []

              yield* loop.run({
                focus: `@${filePath}`,
                specsPath: opts.specsPath,
                cwd: storage.cwd,
                maxIterations: opts.maxIterations,
                setupCommand: opts.setupCommand,
                checkCommand: opts.checkCommand,
                commit: opts.commit
              }).pipe(
                Stream.runForEach((event) =>
                  Effect.sync(() => {
                    Queue.offerUnsafe(queue, event)
                    if(isLoopTerminalEvent(event)) {
                      terminalEvents.push(event)
                    }
                   })
                )
              )

              const outcome = terminalEvents[0] as LoopTerminalEvent | undefined

              // Handle outcome
              if (outcome) {
                switch (outcome._tag) {
                  case "LoopApproved":
                  case "LoopMaxIterations": {
                    // Re-read file and compare hash before deleting
                    const currentContent = yield* fs.readFileString(filePath).pipe(
                      Effect.map((content) => ({ exists: true as const, content })),
                      Effect.catch(() => Effect.succeed({ exists: false as const, content: "" }))
                    )
                    if (currentContent.exists) {
                      const currentHash = Hash.string(currentContent.content)
                      if (currentHash === originalHash) {
                        yield* fs.remove(filePath)
                        yield* Queue.offer(queue, new WatchItemCompleted({ filename: firstFile }))
                      } else {
                        yield* Queue.offer(queue, new WatchItemRetained({ filename: firstFile }))
                      }
                    }
                    break
                  }
                  case "LoopSpecIssue":
                    break
                }
              }
            }
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof WatchError
                ? cause
                : new WatchError({ message: "Watch loop failed", cause })
            )
          )
        )
    }
  })
)
