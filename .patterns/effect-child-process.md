# Effect ChildProcess Module

## Overview

The Effect Platform provides a comprehensive `ChildProcess` module for running external commands and processes. It uses an AST-based approach where commands are built declaratively using `ChildProcess.make` and combinators like `pipeTo`, then executed using `spawn`. This pattern enables type-safe process management with proper resource handling through Effect's Scope system.

**Module Location:** `effect/unstable/process/ChildProcess`

**Platform Implementations:**
- Node.js: `@effect/platform-node`
- Bun: `@effect/platform-bun`

### Key Architecture

Commands are represented as an AST with two node types:

```typescript
// A command that can be executed as a child process
export type Command =
  | StandardCommand  // A single command with arguments
  | PipedCommand     // A pipeline of commands

// Standard command with pre-parsed command and arguments
export interface StandardCommand {
  readonly _tag: "StandardCommand"
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly options: CommandOptions
}

// Pipeline where output of one command is piped to input of the next
export interface PipedCommand {
  readonly _tag: "PipedCommand"
  readonly left: Command
  readonly right: Command
  readonly options: PipeOptions
}
```

### ChildProcessHandle Interface

When a command is spawned, it returns a handle for process interaction:

```typescript
export interface ChildProcessHandle {
  readonly pid: ProcessId
  readonly exitCode: Effect.Effect<ExitCode, PlatformError.PlatformError>
  readonly isRunning: Effect.Effect<boolean, PlatformError.PlatformError>
  readonly kill: (options?: KillOptions) => Effect.Effect<void, PlatformError.PlatformError>
  readonly stdin: Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError>
  readonly stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError>
  readonly stderr: Stream.Stream<Uint8Array, PlatformError.PlatformError>
  readonly all: Stream.Stream<Uint8Array, PlatformError.PlatformError>
  readonly getInputFd: (fd: number) => Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError>
  readonly getOutputFd: (fd: number) => Stream.Stream<Uint8Array, PlatformError.PlatformError>
}
```

### ChildProcessSpawner Service

The spawner is a service abstraction allowing different platform implementations:

```typescript
export interface ChildProcessSpawner {
  readonly spawn: (
    command: Command
  ) => Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope>
}

export const ChildProcessSpawner: ServiceMap.Service<
  ChildProcessSpawner,
  ChildProcessSpawner
> = ServiceMap.Service("effect/process/ChildProcessSpawner")
```

---

## Creating Commands

### Template Literal Form

The most common way to create commands using template literals:

```typescript
import { ChildProcess } from "effect/unstable/process"

// Simple command
const cmd = ChildProcess.make`echo hello world`

// With interpolation
const filename = "test.txt"
const cmd2 = ChildProcess.make`cat ${filename}`

// Array interpolation for flags
const flags = ["-l", "-a"]
const cmd3 = ChildProcess.make`ls ${flags} /tmp`
```

### Template Literal with Options

Pass options before the template literal:

```typescript
import { ChildProcess } from "effect/unstable/process"

// With working directory
const cmd = ChildProcess.make({ cwd: "/tmp" })`ls -la`

// With environment variables
const cmd2 = ChildProcess.make({
  env: { NODE_ENV: "production" },
  extendEnv: true
})`node app.js`
```

### Array Form

Explicit command and arguments array:

```typescript
import { ChildProcess } from "effect/unstable/process"

// Basic array form
const cmd = ChildProcess.make("node", ["--version"])

// With options
const cmd2 = ChildProcess.make("git", ["status"], { cwd: "/app" })

// Command without arguments
const cmd3 = ChildProcess.make("pwd")
```

### Command Options

```typescript
export interface CommandOptions extends KillOptions {
  readonly cwd?: string | undefined
  readonly env?: Record<string, string> | undefined
  readonly extendEnv?: boolean | undefined  // Merge with process.env (default: false)
  readonly shell?: boolean | string | undefined
  readonly detached?: boolean | undefined  // Run independently of parent
  readonly stdin?: CommandInput | StdinConfig | undefined
  readonly stdout?: CommandOutput | StdoutConfig | undefined
  readonly stderr?: CommandOutput | StderrConfig | undefined
  readonly additionalFds?: Record<`fd${number}`, AdditionalFdConfig> | undefined
}
```

### Setting Options After Creation

Use combinators to modify commands:

```typescript
import { ChildProcess } from "effect/unstable/process"

const cmd = ChildProcess.make`ls -la`.pipe(
  ChildProcess.setCwd("/tmp"),
  ChildProcess.setEnv({ LANG: "en_US.UTF-8" })
)
```

---

## Spawning and Running Commands

### Basic Spawn Pattern

```typescript
import { NodeServices } from "@effect/platform-node"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const cmd = ChildProcess.make`echo "hello world"`
  const handle = yield* ChildProcess.spawn(cmd)

  const chunks = yield* Stream.runCollect(handle.stdout)
  const exitCode = yield* handle.exitCode

  return { chunks, exitCode }
}).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer)
)
```

### Using Command as Yieldable

Commands implement `Effect.Yieldable`, so you can yield them directly:

```typescript
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make`node --version`
  const output = yield* Stream.runCollect(handle.stdout)
  return output
}).pipe(Effect.scoped)
```

### Convenience Execution Functions

```typescript
import { ChildProcess } from "effect/unstable/process"

// Get exit code only
const exitCode = yield* ChildProcess.exitCode(ChildProcess.make`echo test`)

// Get output as string
const output = yield* ChildProcess.string(ChildProcess.make`echo hello`)

// Get output lines as array
const lines = yield* ChildProcess.lines(ChildProcess.make`ls -la`)

// Stream output as strings
const stream = ChildProcess.streamString(ChildProcess.make`long-running-process`)

// Stream output line by line
const lineStream = ChildProcess.streamLines(ChildProcess.make`tail -f /var/log/syslog`)

// Include stderr in output
const allOutput = yield* ChildProcess.string(cmd, { includeStderr: true })
```

---

## Capturing stdout/stderr/combined Streams

### Reading stdout

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make`echo "hello world"`

  // Collect all output as Uint8Array chunks
  const chunks = yield* Stream.runCollect(handle.stdout)

  // Decode to string
  const output = yield* Stream.mkString(Stream.decodeText(handle.stdout))

  return output
}).pipe(Effect.scoped)
```

### Reading stderr

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sh", ["-c", "echo error >&2"])
  const stderr = yield* Stream.mkString(Stream.decodeText(handle.stderr))
  return stderr
}).pipe(Effect.scoped)
```

### Reading Combined Output

Use the `all` stream to get interleaved stdout and stderr:

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sh", [
    "-c",
    "echo stdout1; echo stderr1 >&2; echo stdout2"
  ])

  const allOutput = yield* Stream.mkString(Stream.decodeText(handle.all))
  return allOutput
}).pipe(Effect.scoped)
```

### Reading stdout and stderr in Parallel

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const decodeStream = (stream: Stream.Stream<Uint8Array, any>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => {
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      return new TextDecoder().decode(result).trim()
    })
  )

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sh", ["-c", "echo out; echo err >&2"])

  const [stdout, stderr] = yield* Effect.all([
    decodeStream(handle.stdout),
    decodeStream(handle.stderr)
  ], { concurrency: "unbounded" })

  return { stdout, stderr }
}).pipe(Effect.scoped)
```

---

## Writing to stdin

### Using a Stream as stdin

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const inputData = "line1\nline2\nline3"
  const inputStream = Stream.make(new TextEncoder().encode(inputData))

  const handle = yield* ChildProcess.make("cat", { stdin: inputStream })

  const output = yield* Stream.mkString(Stream.decodeText(handle.stdout))
  const exitCode = yield* handle.exitCode

  return { output, exitCode }
}).pipe(Effect.scoped)
```

### Using the stdin Sink

```typescript
import { Effect, Stream, Sink } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("cat")

  const inputStream = Stream.make(
    new TextEncoder().encode("hello "),
    new TextEncoder().encode("world")
  )
  yield* Stream.run(inputStream, handle.stdin)

  const output = yield* Stream.mkString(Stream.decodeText(handle.stdout))
  return output
}).pipe(Effect.scoped)
```

---

## Command Pipelines

### Creating Pipelines

Use `pipeTo` to connect commands:

```typescript
import { ChildProcess } from "effect/unstable/process"

// Simple pipeline
const pipeline = ChildProcess.make`echo hello world`.pipe(
  ChildProcess.pipeTo(ChildProcess.make`tr a-z A-Z`)
)

// Multi-stage pipeline
const multiStage = ChildProcess.make`cat file.txt`.pipe(
  ChildProcess.pipeTo(ChildProcess.make`grep pattern`),
  ChildProcess.pipeTo(ChildProcess.make`wc -l`)
)
```

### Running a Pipeline

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const pipeline = ChildProcess.make`echo hello world`.pipe(
    ChildProcess.pipeTo(ChildProcess.make`tr a-z A-Z`)
  )

  const handle = yield* ChildProcess.spawn(pipeline)
  const output = yield* Stream.mkString(Stream.decodeText(handle.stdout))

  // Returns "HELLO WORLD"
  return output
}).pipe(Effect.scoped)
```

### Pipe Options

Control which stream is piped:

```typescript
import { ChildProcess } from "effect/unstable/process"

// Pipe stderr instead of stdout
const pipeStderr = ChildProcess.make("sh", ["-c", "echo error >&2"]).pipe(
  ChildProcess.pipeTo(ChildProcess.make`cat`, { from: "stderr" })
)

// Pipe combined stdout and stderr
const pipeAll = ChildProcess.make("sh", [
  "-c",
  "echo out; echo err >&2"
]).pipe(
  ChildProcess.pipeTo(ChildProcess.make`cat`, { from: "all" })
)

// Pipe to custom file descriptor
const pipeToFd = ChildProcess.make`echo data`.pipe(
  ChildProcess.pipeTo(ChildProcess.make("sh", ["-c", "cat <&3"]), {
    to: "fd3"
  })
)
```

### Prefix Commands

Add prefixes to commands for timing/tracing:

```typescript
import { ChildProcess } from "effect/unstable/process"

// Add timing to any command
const timedCommand = ChildProcess.make`npm run build`.pipe(
  ChildProcess.prefix`time`
)

// Works with pipelines too (prefixes leftmost command)
const timedPipeline = ChildProcess.make`cat large-file.txt`.pipe(
  ChildProcess.pipeTo(ChildProcess.make`wc -l`),
  ChildProcess.prefix`time`
)
```

---

## Process Control (Kill, Signals)

### Checking Process Status

```typescript
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sleep", ["10"])

  const running = yield* handle.isRunning
  console.log(`Running: ${running}`)

  const exitCode = yield* handle.exitCode
  return exitCode
}).pipe(Effect.scoped)
```

### Killing Processes

```typescript
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sleep", ["60"])

  // Kill with default signal (SIGTERM)
  yield* handle.kill()

  // Kill with specific signal
  yield* handle.kill({ killSignal: "SIGKILL" })

  // Kill with timeout before force kill
  yield* handle.kill({
    killSignal: "SIGTERM",
    forceKillAfter: "5 seconds"
  })
}).pipe(Effect.scoped)
```

### Process Group Management

The Node.js implementation automatically manages process groups:

- Processes are started with `detached: true` on non-Windows platforms
- When killing, the entire process group is terminated (children and grandchildren)
- On scope exit, child processes are properly cleaned up

```typescript
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

// Child processes are automatically cleaned up when scope closes
const program = Effect.scoped(
  Effect.gen(function*() {
    const handle = yield* ChildProcess.make("./long-running-script.sh")

    yield* Effect.sleep("1 second")

    // Process is automatically killed when scope closes
  })
)
```

---

## Additional File Descriptors

### Reading from Custom FDs

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sh", ["-c", "echo 'hello from fd3' >&3"], {
    additionalFds: { fd3: { type: "output" } }
  })

  const fd3Output = yield* Stream.mkString(Stream.decodeText(handle.getOutputFd(3)))
  const exitCode = yield* handle.exitCode

  return { fd3Output, exitCode }
}).pipe(Effect.scoped)
```

### Writing to Custom FDs

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const inputData = "data from parent"
  const inputStream = Stream.make(new TextEncoder().encode(inputData))

  const handle = yield* ChildProcess.make("sh", ["-c", "cat <&3"], {
    additionalFds: {
      fd3: { type: "input", stream: inputStream }
    }
  })

  const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout))
  return stdout
}).pipe(Effect.scoped)
```

### Bidirectional Communication via Custom FDs

```typescript
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const inputData = "hello"
  const inputStream = Stream.make(new TextEncoder().encode(inputData))

  const handle = yield* ChildProcess.make(
    "sh",
    ["-c", "cat <&3 | tr a-z A-Z >&4"],
    {
      additionalFds: {
        fd3: { type: "input", stream: inputStream },
        fd4: { type: "output" }
      }
    }
  )

  const output = yield* Stream.mkString(Stream.decodeText(handle.getOutputFd(4)))
  // Returns "HELLO"
  return output
}).pipe(Effect.scoped)
```

---

## Error Handling

### Handling Non-Zero Exit Codes

```typescript
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make("sh", ["-c", "exit 1"])
  const exitCode = yield* handle.exitCode

  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    console.log(`Command failed with exit code: ${exitCode}`)
  }
}).pipe(Effect.scoped)
```

### Handling Spawn Errors

```typescript
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as PlatformError from "effect/PlatformError"

const program = Effect.gen(function*() {
  const result = yield* Effect.exit(
    ChildProcess.make("nonexistent-command").asEffect()
  )

  if (result._tag === "Failure") {
    console.log("Command failed to start")
  }
}).pipe(Effect.scoped)
```

### Catching Specific Errors

```typescript
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as PlatformError from "effect/PlatformError"

const program = Effect.gen(function*() {
  const result = yield* Effect.flip(
    ChildProcess.make({ cwd: "/nonexistent" })`ls`.asEffect()
  )

  if (PlatformError.isSystemError(result)) {
    if (result.kind === "NotFound") {
      console.log("Directory not found")
    } else if (result.kind === "PermissionDenied") {
      console.log("Permission denied")
    }
  }
}).pipe(Effect.scoped)
```

---

## Platform Setup

### Node.js Setup

```typescript
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make`node --version`
  // ...
}).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer)
)
```

### Custom Spawner Layer

```typescript
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner"
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem"
import * as NodePath from "@effect/platform-node-shared/NodePath"
import { Layer } from "effect"

const NodeServices = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer
  ))
)
```

---

## Testing Patterns

### Mock Spawner for Unit Tests

```typescript
import { Effect, Layer, Stream, Sink } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

const MockSpawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
  spawn: Effect.fnUntraced(function*(command) {
    let cmd = command
    while (cmd._tag === "PipedCommand") {
      cmd = cmd.left
    }

    const executable = cmd._tag === "StandardCommand" ? cmd.command : "unknown"
    const output = new TextEncoder().encode(`mock output for ${executable}`)

    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(12345),
      stdin: Sink.forEach<Uint8Array, void, never, never>((_) => Effect.void),
      stdout: Stream.fromIterable([output]),
      stderr: Stream.fromIterable([new TextEncoder().encode("")]),
      all: Stream.fromIterable([output]),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty
    })
  })
})

// Use in tests
const testProgram = Effect.gen(function*() {
  const handle = yield* ChildProcess.make`echo test`
  const output = yield* Stream.runCollect(handle.stdout)
  // output contains "mock output for echo"
}).pipe(
  Effect.scoped,
  Effect.provide(MockSpawnerLayer)
)
```

---

## Best Practices

### Always Use Effect.scoped

Process handles require scope management for proper cleanup:

```typescript
// Good - scoped cleanup
const program = Effect.scoped(
  Effect.gen(function*() {
    const handle = yield* ChildProcess.make`long-running-process`
    // Process is cleaned up when scope exits
  })
)

// Also good - explicit scope at the end
const program2 = Effect.gen(function*() {
  const handle = yield* ChildProcess.make`long-running-process`
  // ...
}).pipe(Effect.scoped)
```

### Prefer Template Literals for Simple Commands

```typescript
// Preferred for simple commands
const cmd = ChildProcess.make`git status`

// Use array form when building commands dynamically
const args = buildArgs(config)
const cmd2 = ChildProcess.make("git", args)
```

### Never Use `shell: true` with Template Literals

When using `shell: true`, the template literal's argument escaping is **bypassed** because the entire command is passed as a single string to the shell. This defeats the purpose of the template literal form and opens the door to shell injection.

```typescript
// BAD - shell: true bypasses argument escaping
const userInput = "file.txt; rm -rf /"
const cmd = ChildProcess.make({ cwd: "/tmp", shell: true })`cat ${userInput}`
// This runs: sh -c "cat file.txt; rm -rf /"

// GOOD - no shell, arguments are properly escaped
const cmd2 = ChildProcess.make({ cwd: "/tmp" })`cat ${userInput}`
// This runs: cat "file.txt; rm -rf /" (treated as a literal filename)

// GOOD - if you need shell features, use array form explicitly
const cmd3 = ChildProcess.make("sh", ["-c", `cat ${JSON.stringify(userInput)}`])
```

**Rule:** If you need `shell: true`, use the array form (`ChildProcess.make("sh", ["-c", ...])`) where you control the escaping explicitly. Never combine `shell: true` with the template literal form.

### Handle Both stdout and stderr

```typescript
const program = Effect.gen(function*() {
  const handle = yield* ChildProcess.make`my-command`

  // Read both in parallel to avoid deadlock
  const [stdout, stderr] = yield* Effect.all([
    Stream.runCollect(handle.stdout),
    Stream.runCollect(handle.stderr)
  ], { concurrency: "unbounded" })

  const exitCode = yield* handle.exitCode

  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    console.error(new TextDecoder().decode(concatChunks(stderr)))
  }
}).pipe(Effect.scoped)
```

### Use Convenience Functions for Simple Cases

```typescript
// For simple output capture
const output = yield* ChildProcess.string(ChildProcess.make`echo hello`)

// For line-by-line processing
const lines = yield* ChildProcess.lines(ChildProcess.make`git log --oneline`)

// For exit code only
const code = yield* ChildProcess.exitCode(ChildProcess.make`test -f file.txt`)
```

---

## Summary

The Effect ChildProcess module provides:

1. **AST-based command building** - Commands are built declaratively before execution
2. **Type-safe process handles** - Full access to pid, streams, exit codes with proper types
3. **Stream integration** - stdout/stderr/stdin as Effect Streams and Sinks
4. **Pipeline support** - Easy command chaining with flexible pipe options
5. **Resource management** - Automatic cleanup via Effect's Scope system
6. **Process group handling** - Proper cleanup of child processes
7. **Additional FDs** - Support for custom file descriptors (fd3, fd4, etc.)
8. **Cross-platform** - Works on Node.js and Bun with platform-specific implementations
9. **Testability** - Easy to mock the spawner service for testing
