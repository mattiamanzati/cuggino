import { Effect, Layer, ServiceMap, Data, FileSystem, Path, Schema } from "effect"
import * as Uuid from "uuid"

/**
 * Error when storage operations fail
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `Storage ${this.operation} failed`
  }
}

export const CugginoConfig = Schema.Struct({
  specsPath: Schema.String.pipe(Schema.withDecodingDefaultKey(() => ".specs")),
  maxIterations: Schema.Number.pipe(Schema.withDecodingDefaultKey(() => 10)),
  setupCommand: Schema.optionalKey(Schema.String),
  checkCommand: Schema.optionalKey(Schema.String),
  commit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false)),
  audit: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => false)),
  notify: Schema.String.pipe(Schema.withDecodingDefaultKey(() => "none"))
})

export type CugginoConfig = typeof CugginoConfig.Type

export const decodeCugginoConfig = Schema.decodeSync(Schema.fromJsonString(CugginoConfig))
export const encodeCugginoConfig = Schema.encodeSync(Schema.fromJsonString(CugginoConfig))

/**
 * Storage service shape
 */
export interface StorageServiceShape {
  /** Path to the .cuggino root directory */
  readonly rootDir: string

  /** Path to .cuggino/wip */
  readonly wipDir: string

  /** Path to .cuggino/spec-issues */
  readonly specIssuesDir: string

  /** Path to .cuggino/backlog */
  readonly backlogDir: string

  /** Path to .cuggino/tbd */
  readonly tbdDir: string

  /**
   * Write a spec issue to .cuggino/spec-issues/.
   * Generates a UUIDv7 filename, writes the content, and returns the filename.
   */
  readonly writeSpecIssue: (content: string) => Effect.Effect<string, StorageError>

  /**
   * Write a TBD item to .cuggino/tbd/.
   * Generates a UUIDv7 filename, writes the content, and returns the filename.
   */
  readonly writeTbdItem: (content: string) => Effect.Effect<string, StorageError>

  readonly readConfig: () => Effect.Effect<CugginoConfig, StorageError>
  readonly writeConfig: (config: CugginoConfig) => Effect.Effect<void, StorageError>
}

/**
 * Storage service for managing the .cuggino folder structure
 */
export class StorageService extends ServiceMap.Service<StorageService, StorageServiceShape>()("StorageService") {}

/**
 * Create the StorageService layer
 */
export const StorageServiceLayer = (cwd: string) => Layer.effect(
  StorageService,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const rootDir = path.join(cwd, ".cuggino")
    const wipDir = path.join(rootDir, "wip")
    const specIssuesDir = path.join(rootDir, "spec-issues")
    const backlogDir = path.join(rootDir, "backlog")
    const tbdDir = path.join(rootDir, "tbd")

    // Ensure all directories exist
    yield* fs.makeDirectory(rootDir, { recursive: true })
    yield* fs.makeDirectory(wipDir, { recursive: true })
    yield* fs.makeDirectory(specIssuesDir, { recursive: true })
    yield* fs.makeDirectory(backlogDir, { recursive: true })
    yield* fs.makeDirectory(tbdDir, { recursive: true })

    return {
      rootDir,
      wipDir,
      specIssuesDir,
      backlogDir,
      tbdDir,

      writeSpecIssue: (content: string) =>
        Effect.gen(function*() {
          const filename = `${Uuid.v7()}.md`
          yield* fs.writeFileString(path.join(specIssuesDir, filename), content)
          return filename
        }).pipe(
          Effect.catch((cause) =>
            cause instanceof StorageError
              ? Effect.fail(cause)
              : Effect.fail(new StorageError({ operation: "writeSpecIssue", cause }))
          )
        ),

      writeTbdItem: (content: string) =>
        Effect.gen(function*() {
          const filename = `${Uuid.v7()}.md`
          yield* fs.writeFileString(path.join(tbdDir, filename), content)
          return filename
        }).pipe(
          Effect.catch((cause) =>
            cause instanceof StorageError
              ? Effect.fail(cause)
              : Effect.fail(new StorageError({ operation: "writeTbdItem", cause }))
          )
        ),

      readConfig: () =>
        Effect.gen(function*() {
          const configFilePath = path.join(cwd, ".cuggino.json")
          return yield* fs.readFileString(configFilePath).pipe(
            Effect.map((content) => decodeCugginoConfig(content)),
            Effect.catch(() => Effect.succeed(decodeCugginoConfig("{}")))
          )
        }),

      writeConfig: (config: CugginoConfig) =>
        Effect.gen(function*() {
          const configFilePath = path.join(cwd, ".cuggino.json")
          const encoded = encodeCugginoConfig(config) + "\n"
          yield* fs.writeFileString(configFilePath, encoded)
        }).pipe(
          Effect.catch((cause) =>
            cause instanceof StorageError
              ? Effect.fail(cause)
              : Effect.fail(new StorageError({ operation: "writeConfig", cause }))
          )
        )
    }
  })
)
