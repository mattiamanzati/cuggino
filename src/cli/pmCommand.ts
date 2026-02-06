import { Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { StorageService } from "../StorageService.js"
import { LlmAgent } from "../LlmAgent.js"
import { pmCommandPrompt } from "../AgentPrompts.js"
import { AgentLayerMap } from "../AgentLayerMap.js"
import { CliError } from "./command.js"

export const pmCommand = Command.make(
  "pm",
  {
    agent: Flag.choice("agent", ["claude", "codex"]).pipe(
      Flag.withAlias("a"),
      Flag.withDefault("claude"),
      Flag.withDescription("LLM provider to use")
    )
  },
  () =>
    Effect.gen(function*() {
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
  Command.withDescription("Start an interactive PM session"),
  Command.provide((input) =>
    AgentLayerMap.get(input.agent)
  )
)
