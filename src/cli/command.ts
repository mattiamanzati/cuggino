import { Data, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { runCommand } from "./runCommand.js"
import { watchCommand } from "./watchCommand.js"
import { setupCommand } from "./setupCommand.js"
import { StorageService } from "../StorageService.js"
import { LlmAgent } from "../LlmAgent.js"
import { pmCommandPrompt } from "../AgentPrompts.js"
import { AgentLayerMap } from "../AgentLayerMap.js"

export class CliError extends Data.TaggedError("CliError")<{
  readonly message: string
}> {}

export const root = Command.make(
  "cuggino",
  {
    version: Flag.boolean("version").pipe(Flag.withAlias("v")),
    agent: Flag.choice("agent", ["claude", "codex"]).pipe(
      Flag.withAlias("a"),
      Flag.withDefault("claude"),
      Flag.withDescription("LLM provider to use")
    )
  },
  ({ version }) =>
    Effect.gen(function*() {
      if (version) return
      const storage = yield* StorageService
      const config = yield* storage.readConfig()
      const agent = yield* LlmAgent
      const systemPrompt = pmCommandPrompt({
        specsPath: config.specsPath,
        specIssuesPath: storage.specIssuesDir,
        backlogPath: storage.backlogDir,
        tbdPath: storage.tbdDir,
        memoryPath: storage.memoryPath
      })
      const exitCode = yield* agent.interactive({
        cwd: storage.cwd,
        systemPrompt,
        dangerouslySkipPermissions: true
      })
      if (exitCode !== 0) {
        return yield* new CliError({
          message: `Claude process exited with code ${exitCode}`
        })
      }
    })
).pipe(
  Command.withDescription("Autonomous coder loop"),
  Command.withSubcommands([runCommand, watchCommand, setupCommand]),
  Command.provide((input) => AgentLayerMap.get(input.agent))
)
