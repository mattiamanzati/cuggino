# Effect v4 Service Patterns

## Type-Only Service Tag (Abstract Service)

For abstract services that will have implementations provided by different layers:

```typescript
import { ServiceMap, Stream, PlatformError } from "effect"

// Define the service interface
interface MyServiceShape {
  readonly doSomething: (input: string) => Stream.Stream<string, PlatformError.PlatformError>
}

// Create a type-only service tag
const MyService = ServiceMap.Service<MyServiceShape>("MyService")

// Implementations provide layers using Layer.effect
const MyServiceLive = Layer.effect(
  MyService,
  Effect.succeed({
    doSomething: (input) => Stream.succeed(input.toUpperCase())
  })
)
```

## Service Class with Make (Concrete Service)

For services with a default implementation:

```typescript
import { Effect, ServiceMap, Layer } from "effect"

class Config extends ServiceMap.Service<Config, {
  readonly port: number
  readonly host: string
}>()("Config", {
  make: Effect.succeed({
    port: 8080,
    host: "localhost"
  })
}) {
  static layer = Layer.effect(this, this.make)
}
```

## Service with Dependencies

```typescript
class DatabaseClient extends ServiceMap.Service<DatabaseClient, {
  readonly query: (sql: string) => Effect.Effect<string>
}>()("DatabaseClient", {
  make: Effect.gen(function*() {
    const config = yield* Config
    return {
      query: (sql) => Effect.succeed(`Query on ${config.host}: ${sql}`)
    }
  })
}) {
  static layer = Layer.effect(this, this.make)
}
```

## Usage Pattern

```typescript
const program = Effect.gen(function*() {
  const service = yield* MyService
  const result = yield* service.doSomething("hello").pipe(Stream.runCollect)
  return result
})

// Provide the implementation layer
Effect.runPromise(
  program.pipe(
    Effect.provide(MyServiceLive)
  )
)
```
