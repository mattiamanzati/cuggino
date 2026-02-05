import { Effect, Layer, ServiceMap } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export interface NotificationServiceShape {
  readonly repoName: string
  readonly send: (opts: { title: string; body: string }) => Effect.Effect<void>
}

export class NotificationService extends ServiceMap.Service<NotificationService, NotificationServiceShape>()("NotificationService") {}

/**
 * Escape a string for safe inclusion in AppleScript string literals.
 * Replaces backslashes and double quotes.
 */
const escapeAppleScript = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

/**
 * Detect the repository name from Git, falling back to folder basename.
 */
const detectRepoName = (cwd: string): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const cmd = ChildProcess.make({ cwd, shell: true })`git rev-parse --show-toplevel`
      const output = (yield* ChildProcess.string(cmd)).trim()
      const parts = output.split("/")
      return parts[parts.length - 1] || cwd.split("/").pop() || "cuggino"
    })
  ).pipe(
    Effect.catch(() => {
      const parts = cwd.split("/")
      return Effect.succeed(parts[parts.length - 1] || "cuggino")
    })
  )

/**
 * Create the NotificationService layer.
 */
export const NotificationServiceLayer = (cwd: string) => Layer.effect(
  NotificationService,
  Effect.gen(function*() {
    const repoName = yield* detectRepoName(cwd)
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const provide = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)

    return {
      repoName,
      send: ({ title, body }) =>
        Effect.scoped(
          Effect.gen(function*() {
            const safeTitle = escapeAppleScript(title)
            const safeBody = escapeAppleScript(body)
            const safeRepo = escapeAppleScript(repoName)

            const script = [
              `display notification "${safeBody}" with title "${safeTitle}"`,
              `tell application "System Events"`,
              `  set matchingProcesses to every process whose visible is true`,
              `  repeat with p in matchingProcesses`,
              `    try`,
              `      set windowNames to name of every window of p`,
              `      repeat with w in windowNames`,
              `        if w contains "${safeRepo}" then`,
              `          set frontmost of p to true`,
              `          return`,
              `        end if`,
              `      end repeat`,
              `    end try`,
              `  end repeat`,
              `end tell`
            ].join("\n")

            const cmd = ChildProcess.make("osascript", ["-e", script])
            yield* ChildProcess.string(cmd).pipe(provide, Effect.ignore)
          })
        )
    }
  })
)
