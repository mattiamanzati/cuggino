import { Effect, Layer, Stream } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { WatchService, WatchServiceLayer } from "../WatchService.js"
import { StorageService } from "../StorageService.js"
import { withCliOutput } from "../CliOutput.js"
import { AgentLayerMap } from "../AgentLayerMap.js"
import { LoopServiceLayer } from "../LoopService.js"

export const watchCommand = Command.make(
  "watch",
  {
    verbose: Flag.boolean("verbose").pipe(
      Flag.withDescription("Enable verbose output")
    ),
    agent: Flag.choice("agent", ["claude", "codex"]).pipe(
      Flag.withAlias("a"),
      Flag.withDefault("claude"),
      Flag.withDescription("LLM provider to use")
    )
  },
  (args) =>
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
        (s) => withCliOutput(s, args.verbose),
        Stream.runDrain
      )
    })
).pipe(
  Command.provide((input) =>
    WatchServiceLayer.pipe(
      Layer.provideMerge(LoopServiceLayer),
      Layer.provideMerge(AgentLayerMap.get(input.agent))
    )
  )
)
