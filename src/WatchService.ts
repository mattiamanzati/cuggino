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
import {
  WatchBacklogEmpty,
  WatchChangeDetected,
  WatchDebounceComplete,
  WatchProcessingItem,
  WatchItemCompleted,
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
  readonly checkCommand?: string
  readonly commit?: boolean
  readonly audit?: boolean
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
 * Wait for 30s of silence after a change.
 * If another change occurs within the debounce window, reset the timer.
 */
const debounceWatch = (fs: FileSystem.FileSystem, dir: string, debounceMs: number): Effect.Effect<void, WatchError> =>
  Effect.gen(function*() {
    let settled = false
    while (!settled) {
      const result = yield* Effect.race(
        fs.watch(dir).pipe(Stream.take(1), Stream.runDrain, Effect.map(() => "change" as const)),
        Effect.sleep(debounceMs).pipe(Effect.map(() => "timeout" as const))
      )
      if (result === "timeout") {
        settled = true
      }
    }
  }).pipe(
    Effect.mapError((cause) =>
      new WatchError({ message: `Debounce watch failed on ${dir}`, cause })
    )
  )

/**
 * Watch a directory for changes, debounce for 30s, then return.
 * Emits WatchLoopEvents to the provided queue.
 */
const watchForChanges = (
  fs: FileSystem.FileSystem,
  dir: string,
  queue: Queue.Queue<WatchEvent, WatchError | Cause.Done<void>>
): Effect.Effect<void, WatchError> =>
  Effect.gen(function*() {
    yield* Queue.offer(queue, new WatchBacklogEmpty({}))

    yield* fs.watch(dir).pipe(
      Stream.take(1),
      Stream.runDrain
    )

    yield* Queue.offer(queue, new WatchChangeDetected({}))
    yield* debounceWatch(fs, dir, 30_000)
    yield* Queue.offer(queue, new WatchDebounceComplete({}))
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof WatchError
        ? cause
        : new WatchError({ message: `Watch failed on ${dir}`, cause })
    )
  )

/**
 * Watch the spec-issues folder until it becomes empty (with debounce).
 * Emits WatchLoopEvents to the provided queue.
 */
const watchUntilEmpty = (
  fs: FileSystem.FileSystem,
  dir: string,
  queue: Queue.Queue<WatchEvent, WatchError | Cause.Done<void>>
): Effect.Effect<void, WatchError> =>
  Effect.gen(function*() {
    yield* Queue.offer(queue, new WatchSpecIssueWaiting({}))

    while (true) {
      yield* fs.watch(dir).pipe(Stream.take(1), Stream.runDrain)

      yield* Queue.offer(queue, new WatchChangeDetected({}))
      yield* debounceWatch(fs, dir, 30_000)
      yield* Queue.offer(queue, new WatchDebounceComplete({}))

      const files = yield* fs.readDirectory(dir)
      const visibleFiles = files.filter((f) => !f.startsWith("."))
      if (visibleFiles.length === 0) {
        return
      }
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof WatchError
        ? cause
        : new WatchError({ message: `Watch failed on ${dir}`, cause })
    )
  )

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
      cwd: ".",
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
    // acquire: emit start event, fork the audit fiber
    Effect.gen(function*() {
      yield* Queue.offer(queue, new WatchAuditStarted({}))
      return yield* Effect.forkChild(
        runAuditAgent(agent, storage, queue, specsPath).pipe(
          Effect.tap(() => Queue.offer(queue, new WatchAuditEnded({}))),
          Effect.onInterrupt(() => Queue.offer(queue, new WatchAuditInterrupted({})))
        )
      )
    }),
    // use: run the idle effect (folder watcher)
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

    return {
      run: (opts) =>
        Stream.callback<WatchEvent, WatchError, ChildProcessSpawner.ChildProcessSpawner | SessionServiceMap | StorageService>((queue) =>
          Effect.gen(function*() {
            while (true) {
              // Check for spec issues first
              const specIssueFiles = yield* listSorted(fs, storage.specIssuesDir)
              if (specIssueFiles.length > 0) {
                yield* withAuditDuringIdle(
                  watchUntilEmpty(fs, storage.specIssuesDir, queue),
                  opts.audit ?? false,
                  agent,
                  storage,
                  queue,
                  opts.specsPath
                )
                continue
              }

              // Check backlog
              const backlogFiles = yield* listSorted(fs, storage.backlogDir)
              if (backlogFiles.length === 0) {
                yield* withAuditDuringIdle(
                  watchForChanges(fs, storage.backlogDir, queue),
                  opts.audit ?? false,
                  agent,
                  storage,
                  queue,
                  opts.specsPath
                )
                continue
              }

              // Pick first file, read content, run loop
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
                cwd: ".",
                maxIterations: opts.maxIterations,
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
