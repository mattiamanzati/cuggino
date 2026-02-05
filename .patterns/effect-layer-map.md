# LayerMap

## Overview

`LayerMap` is a utility module that provides a **dynamic, reference-counted map of Layer resources**. It lazily acquires and caches resources based on keys, with automatic lifecycle management and optional idle-based cleanup.

Built on top of `RcMap` (Reference-Counted Map) internally.

## Import

```typescript
import { LayerMap } from "effect"
```

## `LayerMap.make`

Creates a LayerMap with a lookup function that dynamically generates layers per key.

```typescript
const map = yield* LayerMap.make(
  (env: string) =>
    Layer.succeed(DatabaseService)({
      query: (sql) => Effect.succeed(`${env}: ${sql}`)
    }),
  { idleTimeToLive: "5 seconds" }
)

// Get a Layer for a specific key — resource is created lazily
const devLayer = map.get("development")

// Use it like any other Layer
const result = yield* Effect.provide(myEffect, devLayer)
```

**Options:**

| Option | Description |
|--------|-------------|
| `idleTimeToLive` | Duration before idle resources are automatically released |
| `preloadKeys` | Iterable of keys to eagerly create on initialization |

## `LayerMap.fromRecord`

Creates a LayerMap from a predefined record of layers (keys are the record keys).

```typescript
const map = yield* LayerMap.fromRecord({
  development: Layer.succeed(Database)({ query: devQuery }),
  production: Layer.succeed(Database)({ query: prodQuery })
}, {
  idleTimeToLive: "10 seconds",
  preload: true
})

const devLayer = map.get("development")
```

## `LayerMap.Service`

Higher-level abstraction for creating a tagged LayerMap as a service. This is the recommended pattern for dependency injection.

```typescript
class GreeterMap extends LayerMap.Service<GreeterMap>()("GreeterMap", {
  lookup: (name: string) =>
    Layer.succeed(Greeter)({
      greet: Effect.succeed(`Hello, ${name}!`)
    }),
  idleTimeToLive: "5 seconds"
}) {}

// Use .get(key) to obtain a Layer for that key
// Use .layer to provide the LayerMap service itself
const program = Effect.gen(function*() {
  const greeter = yield* Greeter
  console.log(yield* greeter.greet)
}).pipe(
  Effect.provide(GreeterMap.get("John")),
  Effect.provide(GreeterMap.layer)
)
```

**Static members on the class:**

| Member | Description |
|--------|-------------|
| `.layer` | Layer that provides the LayerMap service (with dependencies) |
| `.layerNoDeps` | Layer without dependency management |
| `.get(key)` | Returns a `Layer` for the given key |
| `.services(key)` | Returns the `ServiceMap` for the given key (requires `Scope`) |
| `.invalidate(key)` | Invalidates cached resources for the given key |

## Instance Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `(key: K) => Layer<I, E>` | Returns a Layer for the given key |
| `services` | `(key: K) => Effect<ServiceMap<I>, E, Scope>` | Returns services directly (scoped) |
| `invalidate` | `(key: K) => Effect<void>` | Evicts cached resources for the key |

## Key Characteristics

- **Lazy**: Resources are only created when first requested via `get()` or `services()`
- **Cached**: Subsequent requests for the same key reuse the existing resource
- **Reference-counted**: Resources are released when no longer referenced
- **Idle cleanup**: Optional `idleTimeToLive` for automatic release of unused resources
