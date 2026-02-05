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
        setupCommand: Prompt.text({
          message: "Setup command (install deps, build, etc.) — leave empty to skip",
          default: existingConfig.setupCommand ?? ""
        }),
        checkCommand: Prompt.text({
          message: "Check command (linting, type checking, tests) — leave empty to skip",
          default: existingConfig.checkCommand ?? ""
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
      const config = {
        ...result,
        setupCommand: result.setupCommand.trim() || undefined,
        checkCommand: result.checkCommand.trim() || undefined
      }
      yield* storage.writeConfig(config)
      yield* Effect.sync(() => {
        console.log("\nConfiguration saved to .cuggino.json:\n")
        console.log(`  specsPath:      ${config.specsPath}`)
        console.log(`  maxIterations:  ${config.maxIterations}`)
        console.log(`  setupCommand:   ${config.setupCommand || "(none)"}`)
        console.log(`  checkCommand:   ${config.checkCommand || "(none)"}`)
        console.log(`  commit:         ${config.commit}`)
        console.log(`  audit:          ${config.audit}`)
        console.log()
      })
    })
)
