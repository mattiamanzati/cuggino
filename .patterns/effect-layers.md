# Effect Layer Patterns

## Overview

Layers are the primary mechanism for dependency injection and service composition in Effect. A `Layer<ROut, E, RIn>` describes how to build services:
- **ROut**: The services this layer provides
- **E**: Possible errors during layer construction
- **RIn**: The services this layer requires as dependencies

By default, layers are shared (memoized) - if the same layer is used twice, it will only be allocated once.

## Layer Creation Patterns

### Layer.succeed - Constant Values

Use for services with no setup or effectful initialization:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Config extends ServiceMap.Service<Config, {
  readonly apiUrl: string
  readonly port: number
}>()("Config") {}

// Create a layer from a concrete value
const ConfigLayer = Layer.succeed(Config)({
  apiUrl: "https://api.example.com",
  port: 8080
})
```

**When to use**: Static configuration, simple value services, services with no initialization logic.

### Layer.sync - Lazy Synchronous Initialization

Use when the service can be created synchronously but should be deferred:

```typescript
import { Layer, ServiceMap } from "effect"

class Random extends ServiceMap.Service<Random, {
  readonly next: () => number
}>()("Random") {}

const RandomLayer = Layer.sync(Random)(() => ({
  next: () => Math.random()
}))
```

**When to use**: Services that need lazy initialization but do not require async operations or Effect capabilities.

### Layer.effect - Effectful Initialization

Use when service creation requires effects (async, failures, or dependencies):

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

class Config extends ServiceMap.Service<Config, {
  readonly connectionString: string
}>()("Config") {}

// Layer that depends on Config service
const DatabaseLayer = Layer.effect(Database)(
  Effect.gen(function*() {
    const config = yield* Config

    // Effectful initialization
    yield* Effect.log(`Connecting to: ${config.connectionString}`)

    return {
      query: (sql: string) => Effect.succeed(`Query: ${sql}`)
    }
  })
)
```

**When to use**: Services requiring async initialization, services with dependencies, services that can fail during construction.

### Layer.effectServices - Multiple Services from One Effect

Create a layer providing multiple services from a single effect:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

class Logger extends ServiceMap.Service<Logger, {
  readonly log: (msg: string) => Effect.Effect<void>
}>()("Logger") {}

const layer = Layer.effectServices(
  Effect.succeed(
    ServiceMap.make(Database, {
      query: (sql: string) => Effect.succeed(`Query: ${sql}`)
    }).pipe(
      ServiceMap.add(Logger, {
        log: (msg: string) => Effect.sync(() => console.log(msg))
      })
    )
  )
)
```

### Layer.effectDiscard - Side Effects Only

Run an effect during layer construction without providing services:

```typescript
import { Effect, Layer } from "effect"

const initLayer = Layer.effectDiscard(
  Effect.sync(() => {
    console.log("Initializing application...")
  })
)
```

## Providing Dependencies

### Layer.provide - Supply Dependencies

Use `Layer.provide` to supply dependencies to a layer:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Config extends ServiceMap.Service<Config, {
  readonly connectionString: string
}>()("Config") {}

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

// Config layer has no dependencies
const ConfigLayer = Layer.succeed(Config)({
  connectionString: "postgres://localhost/mydb"
})

// Database layer depends on Config
const DatabaseLayer = Layer.effect(Database)(
  Effect.gen(function*() {
    const config = yield* Config
    return { query: (sql) => Effect.succeed(`Connected to ${config.connectionString}: ${sql}`) }
  })
)

// Provide Config to Database, creating a self-contained layer
const DatabaseWithConfig = DatabaseLayer.pipe(
  Layer.provide(ConfigLayer)
)

// Now DatabaseWithConfig has no dependencies - it provides Database
```

### Layer.provideMerge - Provide and Keep Dependencies

Unlike `Layer.provide`, this keeps the dependency services in the output:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

class Logger extends ServiceMap.Service<Logger, {
  readonly log: (msg: string) => Effect.Effect<void>
}>()("Logger") {}

class UserService extends ServiceMap.Service<UserService, {
  readonly getUser: (id: string) => Effect.Effect<{ id: string; name: string }>
}>()("UserService") {}

const databaseLayer = Layer.succeed(Database)({
  query: (sql: string) => Effect.succeed(`DB: ${sql}`)
})

const loggerLayer = Layer.succeed(Logger)({
  log: (msg: string) => Effect.sync(() => console.log(`[LOG] ${msg}`))
})

// UserService depends on Database and Logger
const userServiceLayer = Layer.effect(UserService)(Effect.gen(function*() {
  const database = yield* Database
  const logger = yield* Logger

  return {
    getUser: (id: string) =>
      Effect.gen(function*() {
        yield* logger.log(`Looking up user ${id}`)
        const result = yield* database.query(`SELECT * FROM users WHERE id = ${id}`)
        return { id, name: result }
      })
  }
}))

// provideMerge keeps Database and Logger in the output
const allServicesLayer = userServiceLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(databaseLayer, loggerLayer))
)

// Now the layer provides UserService, Database, AND Logger
const program = Effect.gen(function*() {
  const userService = yield* UserService
  const logger = yield* Logger // Still available!
  const database = yield* Database // Still available!

  const user = yield* userService.getUser("123")
  yield* logger.log(`Found user: ${user.name}`)

  return user
}).pipe(
  Effect.provide(allServicesLayer)
)
```

## Combining Layers

### Layer.mergeAll - Combine Independent Layers

Combine multiple independent layers concurrently:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

class Logger extends ServiceMap.Service<Logger, {
  readonly log: (msg: string) => Effect.Effect<void>
}>()("Logger") {}

class Cache extends ServiceMap.Service<Cache, {
  readonly get: (key: string) => Effect.Effect<string | undefined>
}>()("Cache") {}

const DatabaseLayer = Layer.succeed(Database)({
  query: (sql) => Effect.succeed(`Result: ${sql}`)
})

const LoggerLayer = Layer.succeed(Logger)({
  log: (msg) => Effect.sync(() => console.log(msg))
})

const CacheLayer = Layer.succeed(Cache)({
  get: (key) => Effect.succeed(undefined)
})

// Merge all layers into one - they build concurrently
const AppLayer = Layer.mergeAll(DatabaseLayer, LoggerLayer, CacheLayer)
```

### Layer.merge - Binary Layer Combination

Merge exactly two layers:

```typescript
import { Layer, ServiceMap } from "effect"

// Merge incrementally with pipe
const AppLayer = DatabaseLayer.pipe(
  Layer.merge(LoggerLayer),
  Layer.merge(CacheLayer)
)
```

## Error Handling

### Layer.catchTag - Handle Specific Errors

Recover from specific tagged errors during layer construction:

```typescript
import { Data, Effect, Layer, ServiceMap } from "effect"

class ConfigError extends Data.TaggedError("ConfigError") {}

class Config extends ServiceMap.Service<Config, {
  readonly apiUrl: string
}>()("Config") {}

// Layer that might fail
const configLayer = Layer.effect(Config)(
  Effect.fail(new ConfigError())
)

// Fallback layer
const fallbackLayer = Layer.succeed(Config)({
  apiUrl: "http://localhost"
})

// Recover from ConfigError
const recovered = configLayer.pipe(
  Layer.catchTag("ConfigError", () => fallbackLayer)
)
```

### Layer.catch - Handle All Errors

Recover from any error:

```typescript
import { Data, Effect, Layer, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

const primaryDbLayer = Layer.effect(Database)(
  Effect.fail(new Error("Connection failed"))
)

const fallbackDbLayer = Layer.succeed(Database)({
  query: (sql) => Effect.succeed(`Fallback: ${sql}`)
})

// Recover from any error
const reliableDbLayer = primaryDbLayer.pipe(
  Layer.catch(() => fallbackDbLayer)
)
```

### Layer.catchCause - Handle Causes

Recover from any cause including defects:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

const primaryDbLayer = Layer.effect(Database)(
  Effect.die(new Error("Fatal error"))
)

const fallbackDbLayer = Layer.succeed(Database)({
  query: (sql) => Effect.succeed(`Memory: ${sql}`)
})

// Recover from any cause
const reliableDbLayer = primaryDbLayer.pipe(
  Layer.catchCause(() => fallbackDbLayer)
)
```

### Layer.orDie - Convert Errors to Defects

Remove errors from the layer type by converting them to fiber deaths:

```typescript
import { Layer, ServiceMap, Effect } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

const flakyDbLayer = Layer.effect(Database)(
  Effect.gen(function*() {
    if (Math.random() > 0.5) {
      yield* Effect.fail(new Error("Connection failed"))
    }
    return { query: (sql) => Effect.succeed(`Result: ${sql}`) }
  })
)

// Convert failures to fiber death - removes error from type
const reliableDbLayer = flakyDbLayer.pipe(Layer.orDie)
// Type: Layer<Database, never, never>
```

## Advanced Patterns

### Layer.flatMap - Dynamic Layer Construction

Build layers dynamically based on the output of another layer:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Config extends ServiceMap.Service<Config, {
  readonly dbUrl: string
  readonly logLevel: string
}>()("Config") {}

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}

class Logger extends ServiceMap.Service<Logger, {
  readonly log: (msg: string) => Effect.Effect<void>
}>()("Logger") {}

const configLayer = Layer.succeed(Config)({
  dbUrl: "postgres://localhost:5432/mydb",
  logLevel: "debug"
})

// Dynamically create services based on config
const dynamicServiceLayer = configLayer.pipe(
  Layer.flatMap((services) => {
    const config = ServiceMap.get(services, Config)

    const dbLayer = Layer.succeed(Database)({
      query: (sql: string) => Effect.succeed(`Querying ${config.dbUrl}: ${sql}`)
    })

    const loggerLayer = Layer.succeed(Logger)({
      log: (msg: string) =>
        config.logLevel === "debug"
          ? Effect.sync(() => console.log(`[DEBUG] ${msg}`))
          : Effect.sync(() => console.log(msg))
    })

    return Layer.mergeAll(dbLayer, loggerLayer)
  })
)
```

### Layer.fresh - Disable Memoization

Create a new instance each time instead of sharing:

```typescript
import { Effect, Layer, Ref, ServiceMap } from "effect"

class Counter extends ServiceMap.Service<Counter, {
  readonly increment: () => Effect.Effect<number>
}>()("Counter") {}

const counterLayer = Layer.effect(Counter)(Effect.gen(function*() {
  const ref = yield* Ref.make(0)
  return {
    increment: () => Ref.updateAndGet(ref, (n) => n + 1)
  }
}))

// By default, layers are shared - same instance used everywhere
const sharedProgram = Effect.gen(function*() {
  const counter1 = yield* Counter
  const counter2 = yield* Counter
  // counter1 and counter2 are the same instance
}).pipe(Effect.provide(counterLayer))

// Fresh layer creates a new instance each time
const freshProgram = Effect.gen(function*() {
  const counter = yield* Counter
  // Each Effect.provide creates a new counter
}).pipe(Effect.provide(Layer.fresh(counterLayer)))
```

### Layer.updateService - Modify Existing Service

Update a service in the context with a new implementation:

```typescript
import { Layer, ServiceMap } from "effect"

class Logger extends ServiceMap.Service<Logger, {
  readonly log: (msg: string) => Effect.Effect<void>
}>()("Logger") {}

const baseLoggerLayer = Layer.succeed(Logger)({
  log: (msg) => Effect.sync(() => console.log(msg))
})

// Wrap the logger to add a prefix
const prefixedLoggerLayer = Layer.updateService(baseLoggerLayer, Logger, (logger) => ({
  log: (msg) => logger.log(`[APP] ${msg}`)
}))
```

### Layer.launch - Run Layer as Application

Build a layer and keep it running until interrupted:

```typescript
import { Console, Effect, Layer, ServiceMap } from "effect"

class HttpServer extends ServiceMap.Service<HttpServer, {
  readonly start: () => Effect.Effect<string>
}>()("HttpServer") {}

const serverLayer = Layer.effect(HttpServer)(Effect.gen(function*() {
  yield* Console.log("Starting HTTP server...")
  return {
    start: () => Effect.succeed("Server started")
  }
}))

// Launch runs the layer until interrupted
const application = serverLayer.pipe(
  Layer.launch,
  Effect.tap(() => Console.log("Application completed"))
)

// This will run forever until externally interrupted
// Effect.runFork(application)
```

## Testing Patterns

### Layer.mock - Partial Mock for Testing

Create a partial mock for testing - only implement methods you need:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class UserService extends ServiceMap.Service<UserService, {
  readonly config: { apiUrl: string }
  readonly getUser: (id: string) => Effect.Effect<{ id: string; name: string }, Error>
  readonly deleteUser: (id: string) => Effect.Effect<void, Error>
  readonly updateUser: (id: string, data: object) => Effect.Effect<{ id: string; name: string }, Error>
}>()("UserService") {}

// Create a partial mock - only implement what you need
const testUserLayer = Layer.mock(UserService)({
  config: { apiUrl: "https://test-api.com" }, // Required - non-Effect property
  getUser: (id: string) => Effect.succeed({ id, name: "Test User" })
  // deleteUser and updateUser are omitted - will throw UnimplementedError if called
})

// Use in tests
const testProgram = Effect.gen(function*() {
  const userService = yield* UserService
  const user = yield* userService.getUser("123") // Works
  // yield* userService.deleteUser("123") // Would throw UnimplementedError
}).pipe(Effect.provide(testUserLayer))
```

### Direct Layer.succeed for Simple Mocks

For simple one-off mocks, use `Layer.succeed` directly:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class DatabaseService extends ServiceMap.Service<DatabaseService, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("DatabaseService") {}

// Simple mock for testing
const testDbLayer = Layer.succeed(DatabaseService)({
  query: (sql) => Effect.succeed("mocked result")
})
```

## Summary Table

| Pattern | Use Case | Example |
|---------|----------|---------|
| `Layer.succeed` | Constant value services | `Layer.succeed(Config)({ port: 8080 })` |
| `Layer.sync` | Lazy sync initialization | `Layer.sync(Random)(() => ({ next: Math.random }))` |
| `Layer.effect` | Effectful initialization | `Layer.effect(Database)(Effect.gen(...))` |
| `Layer.provide` | Supply dependencies | `layer.pipe(Layer.provide(deps))` |
| `Layer.provideMerge` | Supply and keep dependencies | `layer.pipe(Layer.provideMerge(deps))` |
| `Layer.mergeAll` | Combine independent layers | `Layer.mergeAll(a, b, c)` |
| `Layer.merge` | Binary layer combination | `a.pipe(Layer.merge(b))` |
| `Layer.catchTag` | Handle specific error | `layer.pipe(Layer.catchTag("E", fallback))` |
| `Layer.catch` | Handle any error | `layer.pipe(Layer.catch(() => fallback))` |
| `Layer.orDie` | Convert errors to defects | `layer.pipe(Layer.orDie)` |
| `Layer.flatMap` | Dynamic layer construction | `layer.pipe(Layer.flatMap(f))` |
| `Layer.fresh` | Disable memoization | `Layer.fresh(layer)` |
| `Layer.mock` | Partial test mocks | `Layer.mock(Service)({ partial })` |
