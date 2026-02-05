import { Effect, Stream } from "effect"
import { Command } from "effect/unstable/cli"
import { WatchService } from "../WatchService.js"
import { StorageService } from "../StorageService.js"
import { withCliOutput } from "../CliOutput.js"

export const watchCommand = Command.make(
  "watch",
  {},
  () =>
    Effect.gen(function*() {
      const storage = yield* StorageService
      const config = yield* storage.readConfig()
      const watchService = yield* WatchService
      yield* watchService.run({
        specsPath: config.specsPath,
        maxIterations: config.maxIterations,
        setupCommand: config.setupCommand,
        checkCommand: config.checkCommand,
        commit: config.commit,
        audit: config.audit,
        notify: config.notify
      }).pipe(
        withCliOutput,
        Stream.runDrain
      )
    })
)
