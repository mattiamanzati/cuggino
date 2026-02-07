import { describe, it, expect } from "vitest"
import { Console, Effect, FileSystem, Layer, Path, Terminal } from "effect"
import { Command } from "effect/unstable/cli"
import { ChildProcessSpawner } from "effect/unstable/process"
import { runCommand } from "../../src/cli/runCommand.js"

const TerminalLayer = Layer.succeed(
  Terminal.Terminal,
  Terminal.make({
    columns: Effect.succeed(80),
    display: () => Effect.void,
    readInput: Effect.never,
    readLine: Effect.succeed("")
  })
)

const TestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  TerminalLayer,
  Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({})
)

describe("runCommand", () => {
  it("requires --focus flag", async () => {
    const run = Command.runWith(runCommand, { version: "0.0.0" })

    const captured: Array<string> = []
    const captureConsole: Console.Console = {
      ...globalThis.console,
      log: (...args: Array<any>) => { captured.push(args.join(" ")) },
      error: (...args: Array<any>) => { captured.push(args.join(" ")) }
    }

    await Effect.runPromise(
      run([]).pipe(
        Effect.provide(TestLayer),
        Effect.provideService(Console.Console, captureConsole)
      ) as Effect.Effect<void>
    )

    const output = captured.join("\n")
    expect(output).toContain("Missing required flag")
    expect(output).toContain("focus")
  })
})
