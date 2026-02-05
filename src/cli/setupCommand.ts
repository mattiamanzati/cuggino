import { Effect } from "effect"
import { Command, Prompt } from "effect/unstable/cli"
import { StorageService } from "../StorageService.js"

export const setupCommand = Command.make(
  "setup",
  {},
  () =>
    Effect.gen(function*() {
      const storage = yield* StorageService
      const existingConfig = yield* storage.readConfig()
      const result = yield* Prompt.all({
        specsPath: Prompt.text({
          message: "Path to the specifications folder",
          default: existingConfig.specsPath
        }),
        maxIterations: Prompt.integer({
          message: "Maximum iterations per loop run",
          min: 1
        }),
        checkCommand: Prompt.text({
          message: "Check command (linting, type checking, tests)",
          default: existingConfig.checkCommand
        }),
        commit: Prompt.toggle({
          message: "Auto-commit after each implementation step",
          initial: existingConfig.commit
        }),
        audit: Prompt.toggle({
          message: "Run audit agent during idle time",
          initial: existingConfig.audit
        })
      }).pipe(Prompt.run)
      yield* storage.writeConfig(result)
      yield* Effect.sync(() => {
        console.log("\nConfiguration saved to .cuggino.json:\n")
        console.log(`  specsPath:      ${result.specsPath}`)
        console.log(`  maxIterations:  ${result.maxIterations}`)
        console.log(`  checkCommand:   ${result.checkCommand}`)
        console.log(`  commit:         ${result.commit}`)
        console.log(`  audit:          ${result.audit}`)
        console.log()
      })
    })
)
