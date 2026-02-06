import { Effect, Layer, Stream } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { LoopService, LoopServiceLayer } from "../LoopService.js"
import { StorageService } from "../StorageService.js"
import { withCliOutput } from "../CliOutput.js"
import { isLoopTerminalEvent, type LoopTerminalEvent } from "../LoopEvent.js"
import { CliError } from "./command.js"
import { AgentLayerMap } from "../AgentLayerMap.js"

export const runCommand = Command.make(
  "run",
  {
    focus: Flag.string("focus").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("The focus area to work on (e.g., 'Implement user authentication')")
    ),
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
      const loop = yield* LoopService
      const stream = loop.run({
        focus: args.focus,
        specsPath: config.specsPath,
        cwd: storage.cwd,
        maxIterations: config.maxIterations,
        setupCommand: config.setupCommand,
        checkCommand: config.checkCommand,
        commit: config.commit
      })

      const terminalEvents: Array<LoopTerminalEvent> = []

      yield* stream.pipe(
        (s) => withCliOutput(s, args.verbose),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (isLoopTerminalEvent(event)) {
              terminalEvents.push(event)
            }
          })
        )
      )

      const outcome = terminalEvents[0] as LoopTerminalEvent | undefined

      if (outcome) {
        switch (outcome._tag) {
          case "LoopSpecIssue":
            return yield* new CliError({ message: "Loop ended with a spec issue" })
          case "LoopMaxIterations":
            return yield* new CliError({ message: "Loop reached max iterations without approval" })
        }
      }
    })
).pipe(
  Command.provide((input) =>
    LoopServiceLayer.pipe(
      Layer.provideMerge(AgentLayerMap.get(input.agent))
    )
  )
)
