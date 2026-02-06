import { Data, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { runCommand } from "./runCommand.js"
import { watchCommand } from "./watchCommand.js"
import { setupCommand } from "./setupCommand.js"
import { pmCommand } from "./pmCommand.js"

export class CliError extends Data.TaggedError("CliError")<{
  readonly message: string
}> {}

export const root = Command.make(
  "cuggino",
  {
    version: Flag.boolean("version").pipe(Flag.withAlias("v"))
  },
  ({ version }) =>
    Effect.gen(function*() {
      if (version) return
    })
).pipe(
  Command.withDescription("Autonomous coder loop"),
  Command.withSubcommands([pmCommand, runCommand, watchCommand, setupCommand])
)
