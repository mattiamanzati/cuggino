import { Effect } from "effect"
import { Command, Flag, Prompt } from "effect/unstable/cli"
import { StorageService } from "../StorageService.js"
import { AgentLayerMap } from "../AgentLayerMap.js"

export const setupCommand = Command.make(
  "setup",
  {
  },
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
        push: Prompt.text({
          message: "Push to remote after each commit (e.g., origin/main) — leave empty to skip",
          default: existingConfig.push ?? ""
        }),
        audit: Prompt.toggle({
          message: "Run audit agent during idle time",
          initial: existingConfig.audit
        }),
        notify: Prompt.select({
          message: "Notification method when watch mode is idle",
          choices: [
            { title: "none", value: "none" },
            { title: "osx-notification", value: "osx-notification" }
          ]
        })
      }).pipe(Prompt.run)
      const { setupCommand, checkCommand, push, ...rest } = result
      const config = {
        ...rest,
        ...(setupCommand.trim() !== "" ? { setupCommand: setupCommand.trim() } : {}),
        ...(checkCommand.trim() !== "" ? { checkCommand: checkCommand.trim() } : {}),
        ...(push.trim() !== "" ? { push: push.trim() } : {})
      }
      yield* storage.writeConfig(config)
      yield* Effect.sync(() => {
        process.stdout.write("\nConfiguration saved to .cuggino.json:\n\n")
        process.stdout.write(`  specsPath:      ${config.specsPath}\n`)
        process.stdout.write(`  maxIterations:  ${config.maxIterations}\n`)
        process.stdout.write(`  setupCommand:   ${config.setupCommand || "(none)"}\n`)
        process.stdout.write(`  checkCommand:   ${config.checkCommand || "(none)"}\n`)
        process.stdout.write(`  commit:         ${config.commit}\n`)
        process.stdout.write(`  push:           ${config.push || "(none)"}\n`)
        process.stdout.write(`  audit:          ${config.audit}\n`)
        process.stdout.write(`  notify:         ${config.notify}\n`)
        process.stdout.write("\n")
      })
    })
)