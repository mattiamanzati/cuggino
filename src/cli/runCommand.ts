import { Effect, Stream } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { LoopService } from "../LoopService.js"
import { StorageService } from "../StorageService.js"
import { withCliOutput } from "../CliOutput.js"

export const runCommand = Command.make(
  "run",
  {
    focus: Flag.string("focus").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("The focus area to work on (e.g., 'Implement user authentication')")
    )
  },
  (args) =>
    Effect.gen(function*() {
      const storage = yield* StorageService
      const config = yield* storage.readConfig()
      const loop = yield* LoopService
      const stream = loop.run({
        focus: args.focus,
        specsPath: config.specsPath,
        cwd: ".",
        maxIterations: config.maxIterations,
        checkCommand: config.checkCommand,
        commit: config.commit
      })
      yield* stream.pipe(
        withCliOutput,
        Stream.runDrain
      )
    })
)
