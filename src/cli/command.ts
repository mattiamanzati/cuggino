import { Command, Flag } from "effect/unstable/cli"
import { runCommand } from "./runCommand.js"
import { planCommand } from "./planCommand.js"
import { watchCommand } from "./watchCommand.js"
import { setupCommand } from "./setupCommand.js"

export const root = Command.make("cuggino", {
  version: Flag.boolean("version").pipe(Flag.withAlias("v"))
}).pipe(
  Command.withDescription("Autonomous coder loop"),
  Command.withSubcommands([runCommand, planCommand, watchCommand, setupCommand])
)
