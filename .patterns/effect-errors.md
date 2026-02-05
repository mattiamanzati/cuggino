# Effect Error Definition and Handling Patterns

## Overview

This document provides focused guidance on defining custom errors and handling them in Effect applications. These patterns are based on Effect v4.x conventions from the effect-smol repository.

## Defining Custom Errors with Data.TaggedError

### Basic Tagged Error

The primary pattern for creating custom errors with discrimination support:

```typescript
import { Data, Effect } from "effect"

// Simple tagged error with properties
class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}

// Usage
const validate = (input: string) =>
  input.length === 0
    ? Effect.fail(new ValidationError({ field: "input", message: "Required" }))
    : Effect.succeed(input)
```

**Source**: `/packages/effect/src/Data.ts`

### Tagged Error with Custom Message

Override the `message` getter to provide dynamic error messages:

```typescript
import { Data } from "effect"

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly status: number
  readonly url: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `Network error ${this.status} for ${this.url}`
  }
}
```

### Tagged Error with Computed Properties

Add helper getters for commonly accessed computed values:

```typescript
import { Data } from "effect"

class TransportError extends Data.TaggedError("TransportError")<{
  readonly request: { method: string; url: string }
  readonly cause?: unknown
  readonly description?: string
}> {
  // Helper getter for formatted info
  get methodAndUrl() {
    return `${this.request.method} ${this.request.url}`
  }

  override get message() {
    return this.description
      ? `Transport: ${this.description} (${this.methodAndUrl})`
      : `Transport error (${this.methodAndUrl})`
  }
}
```

**Source**: `/packages/effect/src/unstable/http/HttpClientError.ts` lines 71-89

### Tagged Error with TypeId

Use a TypeId for type guards and runtime identification:

```typescript
import { Data } from "effect"

const TypeId = "myapp/SqlError"

class SqlError extends Data.TaggedError("SqlError")<{
  cause: unknown
  message?: string
}> {
  readonly [TypeId] = TypeId
}

// Type guard
const isSqlError = (u: unknown): u is SqlError =>
  typeof u === "object" && u !== null && TypeId in u
```

**Source**: `/packages/effect/src/unstable/sql/SqlError.ts` lines 1-19

## Error Kind Patterns

### Using String Literal Unions for Error Kinds

Define a set of possible error kinds for categorization:

```typescript
import { Data } from "effect"

type SystemErrorKind =
  | "AlreadyExists"
  | "BadResource"
  | "Busy"
  | "InvalidData"
  | "NotFound"
  | "PermissionDenied"
  | "TimedOut"
  | "UnexpectedEof"
  | "Unknown"
  | "WouldBlock"
  | "WriteZero"

class SystemError extends Data.TaggedError("SystemError")<{
  kind: SystemErrorKind
  module: string
  method: string
  description?: string | undefined
  syscall?: string | undefined
  pathOrDescriptor?: string | number | undefined
  cause?: unknown
}> {
  override get message(): string {
    return `${this.kind}: ${this.module}.${this.method}${
      this.pathOrDescriptor !== undefined ? ` (${this.pathOrDescriptor})` : ""
    }${this.description ? `: ${this.description}` : ""}`
  }
}
```

**Source**: `/packages/effect/src/PlatformError.ts` lines 30-64

## Wrapper Error Pattern

### Grouping Related Errors Under a Single Type

When you have multiple specific error types that should be grouped:

```typescript
import { Data } from "effect"

const TypeId = "myapp/HttpClientError"

// Define specific error types
class TransportError extends Data.TaggedError("TransportError")<{
  readonly request: Request
  readonly cause?: unknown
  readonly description?: string
}> {
  override get message() {
    return `Transport error: ${this.description ?? "unknown"}`
  }
}

class StatusCodeError extends Data.TaggedError("StatusCodeError")<{
  readonly request: Request
  readonly response: Response
  readonly cause?: unknown
  readonly description?: string
}> {
  override get message() {
    return `Status ${this.response.status}: ${this.description ?? "error"}`
  }
}

class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly request: Request
  readonly response: Response
  readonly cause?: unknown
  readonly description?: string
}> {
  override get message() {
    return `Decode error: ${this.description ?? "unknown"}`
  }
}

// Union type for all specific errors
type HttpClientErrorReason = TransportError | StatusCodeError | DecodeError

// Wrapper error that contains any of the specific errors
class HttpClientError extends Data.TaggedError("HttpClientError")<{
  readonly reason: HttpClientErrorReason
}> {
  constructor(props: { readonly reason: HttpClientErrorReason }) {
    // Propagate cause from the inner error
    if ("cause" in props.reason) {
      super({ ...props, cause: props.reason.cause } as any)
    } else {
      super(props)
    }
  }

  readonly [TypeId] = TypeId

  // Expose request from inner error
  get request(): Request {
    return this.reason.request
  }

  // Expose response if available
  get response(): Response | undefined {
    return "response" in this.reason ? this.reason.response : undefined
  }

  // Delegate message to inner error
  override get message(): string {
    return this.reason.message
  }
}
```

**Source**: `/packages/effect/src/unstable/http/HttpClientError.ts` lines 22-60

### Constructor Functions for Wrapper Errors

Provide convenient constructors:

```typescript
import { Data } from "effect"

class BadArgument extends Data.TaggedError("BadArgument")<{
  module: string
  method: string
  description?: string | undefined
  cause?: unknown
}> {
  override get message(): string {
    return `${this.module}.${this.method}${this.description ? `: ${this.description}` : ""}`
  }
}

class SystemError extends Data.TaggedError("SystemError")<{
  kind: string
  module: string
  method: string
  description?: string | undefined
  cause?: unknown
}> {
  override get message(): string {
    return `${this.kind}: ${this.module}.${this.method}${this.description ? `: ${this.description}` : ""}`
  }
}

class PlatformError extends Data.TaggedError("PlatformError")<{
  reason: BadArgument | SystemError
}> {
  constructor(reason: BadArgument | SystemError) {
    if ("cause" in reason) {
      super({ reason, cause: reason.cause } as any)
    } else {
      super({ reason })
    }
  }

  override get message(): string {
    return this.reason.message
  }
}

// Constructor functions
const systemError = (options: {
  readonly kind: string
  readonly module: string
  readonly method: string
  readonly description?: string | undefined
  readonly cause?: unknown
}): PlatformError => new PlatformError(new SystemError(options))

const badArgument = (options: {
  readonly module: string
  readonly method: string
  readonly description?: string | undefined
  readonly cause?: unknown
}): PlatformError => new PlatformError(new BadArgument(options))
```

**Source**: `/packages/effect/src/PlatformError.ts` lines 91-114

## Error Handling Patterns

### Effect.catchTag - Handle Specific Error Types

Handle a single error type by its tag:

```typescript
import { Data, Effect } from "effect"

class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  status: number
}> {}

declare const fetchUser: (id: string) => Effect.Effect<User, ValidationError | NetworkError>

const program = fetchUser("123").pipe(
  Effect.catchTag("ValidationError", (error) => {
    console.log(`Validation failed for: ${error.field}`)
    return Effect.succeed({ id: "default", name: "Default User" })
  }),
  Effect.catchTag("NetworkError", (error) => {
    if (error.status >= 500) {
      // Retry on server errors
      return fetchUser("123").pipe(
        Effect.retry({ times: 3 })
      )
    }
    return Effect.fail(error)
  })
)
```

### Effect.catchTags - Handle Multiple Error Types

Handle multiple error types in a single call:

```typescript
import { Data, Effect } from "effect"

class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  status: number
}> {}

class AuthError extends Data.TaggedError("AuthError")<{
  reason: string
}> {}

class FatalError extends Data.TaggedError("FatalError")<{
  cause: unknown
}> {}

declare const fetchUser: (id: string) => Effect.Effect<User, ValidationError | NetworkError | AuthError>
declare const defaultUser: User
declare const retryPolicy: any

const program = fetchUser("123").pipe(
  Effect.catchTags({
    ValidationError: (error) => Effect.succeed(defaultUser),
    NetworkError: (error) => Effect.retry(fetchUser("123"), retryPolicy),
    AuthError: (error) => Effect.fail(new FatalError({ cause: error }))
  })
)
```

### Layer.catchTag - Handle Layer Errors

Recover from layer construction errors:

```typescript
import { Effect, Layer, ServiceMap } from "effect"

class Config extends ServiceMap.Service<Config, {
  readonly apiUrl: string
}>()("Config") {}

class ConfigError extends Data.TaggedError("ConfigError")<{
  message: string
}> {}

const configLayer = Layer.effect(Config)(
  Effect.fail(new ConfigError({ message: "Config not found" }))
)

const fallbackLayer = Layer.succeed(Config)({
  apiUrl: "http://localhost"
})

const recovered = configLayer.pipe(
  Layer.catchTag("ConfigError", () => fallbackLayer)
)
```

**Source**: `/packages/effect/src/Layer.ts` lines 1425-1474

### Layer.orDie - Convert Errors to Defects

When layer errors should crash the application:

```typescript
import { Layer } from "effect"

// Convert layer errors to defects (unrecoverable)
const reliableLayer = unreliableLayer.pipe(Layer.orDie)
// Type: Layer<A, never, R> - error type is removed
```

**Source**: `/packages/effect/src/Layer.ts` lines 1366-1369

## Summary Table

| Pattern | Use Case | Example |
|---------|----------|---------|
| `Data.TaggedError` | Basic custom error | `class E extends Data.TaggedError("E")<{}>{}` |
| `override get message()` | Dynamic error message | `override get message() { return ... }` |
| `readonly [TypeId]` | Runtime type identification | `readonly [TypeId] = TypeId` |
| Error kind unions | Categorize error types | `type Kind = "A" \| "B" \| "C"` |
| Wrapper error | Group related errors | `class Wrapper<{ reason: A \| B }>` |
| Constructor functions | Convenient error creation | `const makeError = (opts) => new Wrapper(...)` |
| `Effect.catchTag` | Handle single error type | `effect.pipe(Effect.catchTag("E", handler))` |
| `Effect.catchTags` | Handle multiple error types | `effect.pipe(Effect.catchTags({ E: handler }))` |
| `Layer.catchTag` | Handle layer errors | `layer.pipe(Layer.catchTag("E", fallback))` |
| `Layer.orDie` | Convert errors to defects | `layer.pipe(Layer.orDie)` |
