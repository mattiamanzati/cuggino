import { Data, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { planCommandPrompt } from "../AgentPrompts.js"
import { StorageService } from "../StorageService.js"
import { LlmAgent } from "../LlmAgent.js"

class CliError extends Data.TaggedError("CliError")<{
  readonly message: string
}> {}

export const planCommand = Command.make(
  "plan",
  {},
  () =>
    Effect.gen(function*() {
      const storage = yield* StorageService
      const config = yield* storage.readConfig()
      const agent = yield* LlmAgent
      const systemPrompt = planCommandPrompt({
        specsPath: config.specsPath,
        specIssuesPath: storage.specIssuesDir,
        backlogPath: storage.backlogDir,
        tbdPath: storage.tbdDir
      })
      const exitCode = yield* agent.interactive({
        cwd: process.cwd(),
        systemPrompt,
        dangerouslySkipPermissions: true
      })
      if (exitCode !== 0) {
        return yield* new CliError({
          message: `Claude process exited with code ${exitCode}`
        })
      }
    })
)
