# Effect Service Definition Patterns

This document covers how to define services in Effect v4.x using `ServiceMap.Service` and related patterns.

## ServiceMap.Service

The primary way to define services in Effect is using `ServiceMap.Service`. This creates a service tag that can be used for dependency injection.

### Simple Service Definition

For basic services with straightforward shapes:

```typescript
import { Effect, ServiceMap } from "effect"

// Define a simple service - the type parameter is the service shape
const Database = ServiceMap.Service<{
  query: (sql: string) => Effect.Effect<string>
}>("Database")

// Create a ServiceMap with the service implementation
const services = ServiceMap.make(Database, {
  query: (sql) => Effect.succeed(`Result: ${sql}`)
})
```

### Class-Based Service Pattern (Recommended)

For complex services, use the class-based pattern. The class itself becomes the service tag, providing better type inference and IDE support.

```typescript
import { Effect, ServiceMap } from "effect"

// Define a service class - Self type comes first, then the shape
class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
  readonly insert: (table: string, data: object) => Effect.Effect<void>
}>()("Database") {}

// Now Database can be used both as a type and as a service tag
const program = Effect.gen(function*() {
  const db = yield* Database  // Get service from context
  return yield* db.query("SELECT * FROM users")
})
```

Key aspects of the class-based pattern:
- First generic parameter is the class itself (for self-referential typing)
- Second generic parameter is the service shape
- Empty parentheses `()` followed by the service key string `("Database")`
- Use `readonly` for service method signatures

#### Real-World Examples

From the HTTP client:

```typescript
// Simple service with interface type
export const HttpClient: ServiceMap.Service<HttpClient, HttpClient> =
  ServiceMap.Service<HttpClient, HttpClient>("effect/HttpClient")
```

From SQL clients:

```typescript
export const SqliteClient = ServiceMap.Service<SqliteClient>(
  "@effect/sql-sqlite-node/SqliteClient"
)

export const MysqlClient = ServiceMap.Service<MysqlClient>(
  "@effect/sql-mysql2/MysqlClient"
)
```

From platform services:

```typescript
export class HttpPlatform extends ServiceMap.Service<HttpPlatform, {
  readonly fileResponse: (
    path: string,
    status?: number,
    statusText?: string,
    headers?: Headers.Headers,
    options?: FileSystem.StreamOptions
  ) => Effect.Effect<ServerResponse.HttpServerResponse, PlatformError>
}>()("@effect/platform/HttpPlatform") {}
```

## ServiceMap.Reference (Services with Defaults)

Use `ServiceMap.Reference` when you want a service that can have a default value. These can be used without explicit provision in the context.

```typescript
import { ServiceMap } from "effect"

// Reference with a default value
const Logger = ServiceMap.Reference<{ log: (msg: string) => void }>("Logger", {
  defaultValue: () => ({ log: (msg: string) => console.log(msg) })
})

// Can be used without explicit provision - falls back to default
const serviceMap = ServiceMap.empty()
const logger = ServiceMap.get(serviceMap, Logger) // Uses default value
```

### Common Reference Patterns

Configuration references with defaults:

```typescript
// Tracing configuration
export const TracerDisabledWhen = ServiceMap.Reference<
  (request: HttpClientRequest) => boolean
>("effect/HttpClient/TracerDisabledWhen", {
  defaultValue: () => () => false  // Default: never disabled
})

// Name generator with sensible default
export const SpanNameGenerator = ServiceMap.Reference<
  (request: HttpClientRequest) => string
>("effect/HttpClient/SpanNameGenerator", {
  defaultValue: () => (request) => `http.client ${request.method}`
})

// Feature flag reference
export const TracerEnabled = ServiceMap.Reference<boolean>(
  "effect/References/TracerEnabled", {
  defaultValue: () => true
})

// Numeric configuration
export const MaxOpsBeforeYield = ServiceMap.Reference<number>(
  "effect/Scheduler/MaxOpsBeforeYield", {
  defaultValue: () => 2048
})
```

Commonly used built-in references:

```typescript
// Clock service with default implementation
export const Clock: ServiceMap.Reference<Clock> = ServiceMap.Reference<Clock>(
  "effect/Clock", {
  defaultValue: () => globalClockImpl
})

// Random service with default
export const Random = ServiceMap.Reference<{
  readonly next: () => number
  readonly nextInt: (max: number) => number
}>("effect/Random", {
  defaultValue: () => defaultRandomImpl
})

// Console service
export const Console: ServiceMap.Reference<Console> = ServiceMap.Reference(
  "effect/Console", {
  defaultValue: () => defaultConsole
})
```

## Accessing Services

Services can be accessed in several ways within Effect programs.

### Method 1: Using yield* in Effect.gen (Recommended)

```typescript
const program = Effect.gen(function*() {
  const db = yield* Database
  const result = yield* db.query("SELECT * FROM users")
  return result
})
```

### Method 2: Using the .use() Method

```typescript
// Execute a function with the service
const program = Database.use((db) => db.query("SELECT * FROM users"))
```

### Method 3: Using .useSync() for Synchronous Access

```typescript
// For synchronous operations on the service
const program = Database.useSync((db) => db.someProperty)
```

### Method 4: Using Effect.flatMap with asEffect()

```typescript
const program = Effect.flatMap(
  Database.asEffect(),
  (db) => db.query("SELECT * FROM users")
)
```

## Accessor Function Pattern

For better ergonomics, define accessor functions that automatically inject the service dependency. This creates a cleaner API for consumers.

### Basic Accessor Pattern

```typescript
import { Effect, ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
  readonly execute: (sql: string) => Effect.Effect<void>
}>()("app/Database") {}

// Simple accessor that wraps a method
const accessor = (method: keyof Database["Service"]) =>
  (...args: Array<any>): Effect.Effect<any, any, any> =>
    Effect.flatMap(
      Database.asEffect(),
      (db) => (db as any)[method](...args)
    )

// Export typed accessor functions
export const query: (sql: string) => Effect.Effect<
  ReadonlyArray<unknown>,
  never,
  Database
> = accessor("query")

export const execute: (sql: string) => Effect.Effect<
  void,
  never,
  Database
> = accessor("execute")
```

### Real-World Accessor Example (HttpClient)

From the HTTP client implementation:

```typescript
const accessor = (method: keyof HttpClient) =>
  (...args: Array<any>): Effect.Effect<any, any, any> =>
    Effect.flatMap(
      HttpClient.asEffect(),
      (client) => (client as any)[method](...args)
    )

// Typed exports for each HTTP method
export const execute: (
  request: HttpClientRequest.HttpClientRequest
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  Error.HttpClientError,
  HttpClient
> = accessor("execute")

export const get: (
  url: string | URL,
  options?: HttpClientRequest.Options.NoBody
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  Error.HttpClientError,
  HttpClient
> = accessor("get")

export const post: (
  url: string | URL,
  options?: HttpClientRequest.Options.NoUrl
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  Error.HttpClientError,
  HttpClient
> = accessor("post")
```

This pattern allows consumers to write:

```typescript
import * as HttpClient from "effect/unstable/http/HttpClient"

const program = HttpClient.get("https://api.example.com/users")
```

Instead of:

```typescript
const program = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  return yield* client.get("https://api.example.com/users")
})
```

## Service with Make Function

You can include a `make` function directly in the service definition:

```typescript
class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database", {
  make: Effect.gen(function*() {
    // Effectful initialization
    yield* Effect.log("Initializing database")
    return {
      query: (sql) => Effect.succeed(`Result: ${sql}`)
    }
  })
}) {}

// The make effect is available on the class
const layer = Layer.effect(Database)(Database.make)
```

With parameters:

```typescript
class Database extends ServiceMap.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("Database", {
  make: (connectionString: string) => Effect.gen(function*() {
    yield* Effect.log(`Connecting to: ${connectionString}`)
    return {
      query: (sql) => Effect.succeed(`Result: ${sql}`)
    }
  })
}) {}

// Use with parameters
const layer = Layer.effect(Database)(Database.make("postgres://localhost/db"))
```

## Summary Table

| Pattern | Use Case | Example |
|---------|----------|---------|
| `ServiceMap.Service<Shape>("key")` | Simple services | `ServiceMap.Service<{ log: () => void }>("Logger")` |
| `class X extends ServiceMap.Service<X, Shape>()("key") {}` | Complex services with class syntax | `class Db extends ServiceMap.Service<Db, DbShape>()("Db") {}` |
| `ServiceMap.Reference<Shape>("key", { defaultValue })` | Services with defaults | `ServiceMap.Reference<Clock>("Clock", { defaultValue: () => impl })` |
| `yield* Service` | Access service in Effect.gen | `const db = yield* Database` |
| `Service.use(fn)` | Functional service access | `Database.use((db) => db.query(sql))` |
| `accessor("method")` | Create typed accessor functions | `export const query = accessor("query")` |
