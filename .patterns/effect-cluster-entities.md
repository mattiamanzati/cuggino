# Effect Cluster Entities

## Overview

Effect Cluster provides a distributed entity system for building scalable, stateful applications across multiple nodes. Entities are the core abstraction for managing stateful actors that can be addressed by a unique identifier and automatically distributed across cluster runners.

### Key Concepts

- **Entity**: A stateful unit that processes messages according to a defined protocol (RPC definitions)
- **EntityAddress**: A unique address combining entity type, entity ID, and shard ID
- **Sharding**: The mechanism that distributes entities across runners based on consistent hashing
- **Runner**: A node in the cluster that hosts entities
- **MessageStorage**: Persistent storage for durable messaging (optional but recommended for production)

## Defining Entities

### Basic Entity Definition

Entities are created using `Entity.make` with a type name and an array of RPC definitions:

```typescript
import { Schema } from "effect"
import { ClusterSchema, Entity } from "effect/unstable/cluster"
import { Rpc } from "effect/unstable/rpc"

// Define your data models
export class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.String
}) {}

// Define your entity with its protocol
export const UserEntity = Entity.make("UserEntity", [
  Rpc.make("GetUser", {
    success: User,
    payload: { id: Schema.Number }
  }),
  Rpc.make("UpdateName", {
    success: User,
    payload: { userId: Schema.Number, newName: Schema.String }
  }),
  Rpc.make("DeleteUser", {
    payload: { id: Schema.Number }
  })
])
```

### Entity with Persistence Annotations

Mark RPCs as persisted for durability guarantees:

```typescript
export const CounterEntity = Entity.make("Counter", [
  Rpc.make("Increment", {
    payload: { id: Schema.String, amount: Schema.Number },
    primaryKey: ({ id }) => id,  // For deduplication
    success: Schema.Number
  }),
  Rpc.make("GetCount", {
    payload: { id: Schema.String },
    success: Schema.Number
  }),
  // Volatile RPC - not persisted
  Rpc.make("Ping").annotate(ClusterSchema.Persisted, false)
]).annotateRpcs(ClusterSchema.Persisted, true)  // All RPCs persisted by default
```

### Annotations Reference

| Annotation | Type | Description |
|------------|------|-------------|
| `ClusterSchema.Persisted` | `boolean` | Whether messages are durably stored (default: `false`) |
| `ClusterSchema.Uninterruptible` | `boolean \| "client" \| "server"` | Prevents interruption of message processing |
| `ClusterSchema.ShardGroup` | `(entityId: EntityId) => string` | Custom shard group assignment |
| `ClusterSchema.ClientTracingEnabled` | `boolean` | Enable client-side tracing (default: `true`) |

## Implementing Entity Handlers

### Using `toLayer` (Recommended)

The `toLayer` method creates a Layer that registers the entity with Sharding:

```typescript
import { Effect, Layer, MutableRef, Queue, Schema } from "effect"
import { Entity, ClusterSchema } from "effect/unstable/cluster"
import { Rpc } from "effect/unstable/rpc"

// Define the entity
const CounterEntity = Entity.make("Counter", [
  Rpc.make("Increment", {
    payload: { amount: Schema.Number },
    success: Schema.Number
  }),
  Rpc.make("GetCount", {
    success: Schema.Number
  })
])

// Implement handlers with state management
const CounterEntityLayer = CounterEntity.toLayer(
  Effect.gen(function*() {
    // Per-entity state (created once per entity instance)
    const count = MutableRef.make(0)

    // Return handlers for each RPC
    return CounterEntity.of({
      Increment: (envelope) =>
        Effect.sync(() => {
          MutableRef.update(count, (n) => n + envelope.payload.amount)
          return MutableRef.get(count)
        }),
      GetCount: () =>
        Effect.sync(() => MutableRef.get(count))
    })
  }),
  {
    maxIdleTime: "5 minutes",        // Entity shutdown after idle
    concurrency: 1,                   // Sequential message processing (default)
    mailboxCapacity: 100,             // Max queued messages
    defectRetryPolicy: Schedule.forever  // Retry on defects
  }
)
```

### Using `toLayerQueue` (Advanced)

For manual message processing control:

```typescript
const EntityWithQueueLayer = MyEntity.toLayerQueue(
  Effect.gen(function*() {
    return (queue, replier) =>
      Effect.gen(function*() {
        while (true) {
          const request = yield* Queue.take(queue)

          // Custom processing logic
          const result = yield* processRequest(request)

          // Manual reply
          yield* replier.succeed(request, result)
        }
      })
  })
)
```

### Request Envelope Structure

Each handler receives an envelope with:

```typescript
interface Request<Rpc> {
  // The entity address
  readonly address: EntityAddress

  // Unique request ID (Snowflake)
  readonly requestId: Snowflake

  // RPC tag (method name)
  readonly tag: string

  // Decoded payload
  readonly payload: Rpc.Payload<Rpc>

  // HTTP headers (for context propagation)
  readonly headers: Headers.Headers

  // Tracing information
  readonly traceId?: string
  readonly spanId?: string
  readonly sampled?: boolean

  // For stream resumption
  readonly lastSentChunk: Reply.Chunk<Rpc> | undefined
  readonly lastSentChunkValue: Rpc.SuccessChunk<Rpc> | undefined
  readonly nextSequence: number
}
```

## Entity Lifecycle

### Lifecycle Phases

```
                    +------------------+
                    |  Message Arrives |
                    +--------+---------+
                             |
                             v
               +-------------+-------------+
               | Entity Manager Lookup     |
               | (by EntityAddress)        |
               +-------------+-------------+
                             |
          +------------------+------------------+
          | Entity Exists?                      |
          +------------------+------------------+
                  |                    |
                  | No                 | Yes
                  v                    v
         +--------+--------+   +------+------+
         | Create Entity   |   | Add to      |
         | - Build scope   |   | Mailbox     |
         | - Init handlers |   +------+------+
         | - Register      |          |
         +--------+--------+          |
                  |                    |
                  +----------+--------+
                             |
                             v
                   +---------+---------+
                   | Process Message   |
                   | via RpcServer     |
                   +---------+---------+
                             |
                             v
                   +---------+---------+
                   | Update lastActive |
                   | timestamp         |
                   +---------+---------+
```

### Entity Reaper (Idle Timeout)

The EntityReaper monitors entity activity and terminates idle entities:

```typescript
// From internal/entityReaper.ts
// Entities are terminated when:
// - No active requests
// - keepAlive is not enabled
// - Time since last activity > maxIdleTime
```

Configuration:
- `maxIdleTime`: Per-entity or via `ShardingConfig.entityMaxIdleTime` (default: 1 minute)
- Check interval: Minimum of all registered entity idle times (minimum 5 seconds)

### Entity State

Internal entity state includes:

```typescript
interface EntityState {
  readonly address: EntityAddress
  readonly scope: Scope.Scope
  readonly activeRequests: Map<bigint, RequestEntry>
  lastActiveCheck: number
  write: RpcServer.write
  readonly keepAliveLatch: Effect.Latch
  keepAliveEnabled: boolean
}
```

### Defect Handling

When an entity handler throws a defect:
1. The entity's handlers are rebuilt (hot restart)
2. In-flight persisted requests are re-queued
3. Retry follows the configured `defectRetryPolicy`
4. The retry counter resets after 10 seconds of stability

```typescript
const MyEntityLayer = MyEntity.toLayer(buildHandlers, {
  defectRetryPolicy: Schedule.exponential(500, 1.5).pipe(
    Schedule.either(Schedule.spaced("10 seconds"))
  ),
  disableFatalDefects: false  // Allow defect recovery
})
```

## Keeping Entities Alive

### Using `Entity.keepAlive`

Prevent automatic entity termination during important operations:

```typescript
import { Effect } from "effect"
import { Entity } from "effect/unstable/cluster"

const LongRunningHandler = (envelope) =>
  Effect.gen(function*() {
    // Enable keep-alive - entity won't be reaped
    yield* Entity.keepAlive(true)

    try {
      // Long-running operation
      yield* performLongTask()
      return result
    } finally {
      // Disable keep-alive when done
      yield* Entity.keepAlive(false)
    }
  })
```

### Using `EntityResource`

For resources that should survive entity restarts:

```typescript
import { Effect, Duration } from "effect"
import { Entity, EntityResource } from "effect/unstable/cluster"

const MyEntityLayer = MyEntity.toLayer(
  Effect.gen(function*() {
    // Create a resource that survives restarts
    const resource = yield* EntityResource.make({
      acquire: Effect.gen(function*() {
        // Expensive initialization
        const connection = yield* createDatabaseConnection()

        // Use CloseScope for cleanup that only runs on explicit close
        const closeScope = yield* EntityResource.CloseScope
        yield* Scope.addFinalizer(closeScope, closeConnection(connection))

        return connection
      }),
      idleTimeToLive: Duration.minutes(10)
    })

    return MyEntity.of({
      Query: (envelope) =>
        Effect.scoped(Effect.gen(function*() {
          const conn = yield* resource.get
          return yield* queryDatabase(conn, envelope.payload)
        })),
      Close: () => resource.close
    })
  })
)
```

Key behaviors:
- Resource survives entity restarts due to shard movement
- Only released when `idleTimeToLive` expires or `close` is called
- Automatically calls `Entity.keepAlive(true)` during resource lifetime

## Entity Addressing and Communication

### EntityAddress Structure

```typescript
class EntityAddress {
  readonly shardId: ShardId        // { group: string, id: number }
  readonly entityType: EntityType  // Branded string
  readonly entityId: EntityId      // Branded string
}

// Example address
const address = new EntityAddress({
  shardId: ShardId.make("default", 42),
  entityType: "UserEntity" as EntityType,
  entityId: "user-123" as EntityId
})
```

### Shard Assignment

Entities are assigned to shards via consistent hashing:

```typescript
// From Sharding.ts
function getShardId(entityId: EntityId, group: string): ShardId {
  const id = Math.abs(hashString(entityId) % config.shardsPerGroup) + 1
  return ShardId.make(group, id)
}
```

### Creating Entity Clients

```typescript
import { Effect } from "effect"
import { Sharding } from "effect/unstable/cluster"

// Get a client factory
const makeClient = yield* UserEntity.client

// Create client for specific entity
const userClient = makeClient("user-123")

// Call methods on the entity
const user = yield* userClient.GetUser({ id: 1 })
yield* userClient.UpdateName({ userId: 1, newName: "New Name" })
```

### Client Options

```typescript
// Discard - fire and forget
yield* userClient.UpdateName({ userId: 1, newName: "New" }, { discard: true })

// Context propagation
yield* userClient.GetUser({ id: 1 }, {
  context: ServiceMap.make(MyService, myServiceImpl)
})
```

### Message Flow

```
Client                 Sharding               Runner              Entity
  |                        |                     |                   |
  |-- Request ------------>|                     |                   |
  |                        |-- Route to shard -->|                   |
  |                        |                     |-- Create/Get ---->|
  |                        |                     |<-- Ready ---------|
  |                        |                     |-- Deliver ------->|
  |                        |                     |<-- Reply ---------|
  |                        |<-- Route back ------|                   |
  |<-- Response -----------|                     |                   |
```

## Entity Proxy (HTTP/RPC Exposure)

### Creating RPC Groups from Entities

```typescript
import { Entity, EntityProxy, EntityProxyServer } from "effect/unstable/cluster"
import { RpcServer } from "effect/unstable/rpc"

// Convert entity to RPC group
export class MyRpcs extends EntityProxy.toRpcGroup(MyEntity) {}

// Create RPC server layer
const RpcServerLayer = RpcServer.layer(MyRpcs).pipe(
  Layer.provide(EntityProxyServer.layerRpcHandlers(MyEntity))
)
```

### Creating HTTP API from Entities

```typescript
import { Entity, EntityProxy, EntityProxyServer } from "effect/unstable/cluster"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"

// Convert entity to HTTP API group
export class MyApi extends HttpApi.make("api")
  .add(
    EntityProxy.toHttpApiGroup("users", UserEntity)
      .prefix("/users")
  )
{}

// Create HTTP server layer
const ApiLayer = HttpApiBuilder.layer(MyApi).pipe(
  Layer.provide(EntityProxyServer.layerHttpApi(MyApi, "users", UserEntity))
)
```

Generated endpoints:
- `POST /{rpc-name}/:entityId` - Send request and wait for response
- `POST /{rpc-name}/:entityId/discard` - Fire and forget

## Configuration

### ShardingConfig Options

```typescript
import { ShardingConfig } from "effect/unstable/cluster"

const config = ShardingConfig.layer({
  // Runner configuration
  runnerAddress: RunnerAddress.make("localhost", 34431),
  runnerShardWeight: 1,
  shardGroups: ["default"],
  shardsPerGroup: 300,

  // Entity lifecycle
  entityMailboxCapacity: 4096,
  entityMaxIdleTime: "1 minute",
  entityTerminationTimeout: "15 seconds",
  entityRegistrationTimeout: "1 minute",

  // Message processing
  entityMessagePollInterval: "10 seconds",
  entityReplyPollInterval: "200 millis",
  sendRetryInterval: "100 millis",

  // Shard locking
  shardLockRefreshInterval: "10 seconds",
  shardLockExpiration: "35 seconds",

  // Cluster
  refreshAssignmentsInterval: "3 seconds",
  runnerHealthCheckInterval: "1 minute",
  preemptiveShutdown: true,
  simulateRemoteSerialization: true
})
```

## Testing Entities

### Using `Entity.makeTestClient`

```typescript
import { Effect } from "effect"
import { Entity, ShardingConfig } from "effect/unstable/cluster"

const TestShardingConfig = ShardingConfig.layer({
  shardsPerGroup: 300,
  entityMailboxCapacity: 10,
  entityTerminationTimeout: 0,
  entityMessagePollInterval: 5000,
  sendRetryInterval: 100
})

it.effect("entity round trip", () =>
  Effect.gen(function*() {
    // Create test client without full cluster setup
    const makeClient = yield* Entity.makeTestClient(MyEntity, MyEntityLayer)
    const client = yield* makeClient("test-entity-id")

    // Test interactions
    const result = yield* client.MyMethod({ param: "value" })
    expect(result).toEqual(expectedResult)
  }).pipe(Effect.provide(TestShardingConfig))
)
```

### Full Cluster Testing

```typescript
import { TestClock } from "effect/testing"
import {
  MessageStorage,
  RunnerHealth,
  RunnerStorage,
  Runners,
  Sharding,
  ShardingConfig
} from "effect/unstable/cluster"

const TestSharding = MyEntityLayer.pipe(
  Layer.provideMerge(Sharding.layer),
  Layer.provide(RunnerStorage.layerMemory),
  Layer.provide(RunnerHealth.layerNoop),
  Layer.provide(Runners.layerNoop),
  Layer.provide(MessageStorage.layerMemory),
  Layer.provide(TestShardingConfig)
)

it.effect("durable message delivery", () =>
  Effect.gen(function*() {
    yield* TestClock.adjust(1)  // Trigger initial shard assignment

    const makeClient = yield* MyEntity.client
    const client = makeClient("1")

    const result = yield* client.MyMethod({ param: "value" })
    expect(result).toEqual(expectedResult)

    // Verify storage
    const driver = yield* MessageStorage.MemoryDriver
    expect(driver.journal.length).toEqual(1)
    expect(driver.unprocessed.size).toEqual(0)
  }).pipe(Effect.provide(TestSharding))
)
```

## Best Practices

### Entity Design

1. **Keep entities focused**: One entity type per domain concept
2. **Design for idempotency**: Use `primaryKey` for message deduplication
3. **Minimize state**: Store only essential state in-memory
4. **Use persistence wisely**: Mark critical operations as `Persisted`

### Error Handling

1. **Return errors via Effect.fail**: Don't throw exceptions
2. **Use typed errors**: Define error schemas for RPC definitions
3. **Handle defects gracefully**: Configure appropriate retry policies
4. **Consider uninterruptible**: Use for operations that must complete

### Performance

1. **Tune mailbox capacity**: Balance throughput vs memory
2. **Set appropriate idle times**: Match entity lifecycle to access patterns
3. **Use `discard` for fire-and-forget**: Reduces response overhead
4. **Configure shard count**: More shards = better distribution but more overhead

### Production Deployment

1. **Use MessageStorage**: Enable durable messaging with SQL storage
2. **Configure health checks**: Monitor runner health across cluster
3. **Set termination timeouts**: Allow graceful shutdown
4. **Monitor metrics**: Track entity counts, message latency

## Common Patterns

### State Machine Entity

```typescript
const OrderEntity = Entity.make("Order", [
  Rpc.make("Create", { payload: { items: Schema.Array(Item) }, success: Order }),
  Rpc.make("Confirm", { success: Order }),
  Rpc.make("Ship", { success: Order }),
  Rpc.make("Cancel", { success: Order }),
  Rpc.make("GetStatus", { success: OrderStatus })
]).annotateRpcs(ClusterSchema.Persisted, true)

const OrderEntityLayer = OrderEntity.toLayer(
  Effect.gen(function*() {
    const state = MutableRef.make<OrderState>({ status: "pending" })

    return OrderEntity.of({
      Create: (env) => Effect.gen(function*() {
        if (MutableRef.get(state).status !== "pending") {
          return yield* Effect.fail(new OrderAlreadyExists())
        }
        const order = createOrder(env.payload.items)
        MutableRef.set(state, { status: "created", order })
        return order
      }),
      Confirm: () => transition(state, "created", "confirmed"),
      Ship: () => transition(state, "confirmed", "shipped"),
      Cancel: () => transition(state, ["created", "confirmed"], "cancelled"),
      GetStatus: () => Effect.succeed(MutableRef.get(state).status)
    })
  })
)
```

### Aggregate Root Entity

```typescript
const AccountEntity = Entity.make("Account", [
  Rpc.make("Deposit", {
    payload: { amount: Schema.Number },
    primaryKey: () => crypto.randomUUID(), // Each deposit is unique
    success: Schema.Number
  }),
  Rpc.make("Withdraw", {
    payload: { amount: Schema.Number, idempotencyKey: Schema.String },
    primaryKey: ({ idempotencyKey }) => idempotencyKey,
    success: Schema.Number,
    error: InsufficientFunds
  }),
  Rpc.make("GetBalance", { success: Schema.Number })
]).annotateRpcs(ClusterSchema.Persisted, true)
  .annotateRpcs(ClusterSchema.Uninterruptible, true)
```

### Event Sourced Entity (with external storage)

```typescript
const EventSourcedEntity = Entity.make("EventSourced", [
  Rpc.make("ApplyCommand", {
    payload: { command: CommandSchema },
    success: EventSchema
  })
]).annotateRpcs(ClusterSchema.Persisted, true)

const EventSourcedEntityLayer = EventSourcedEntity.toLayer(
  Effect.gen(function*() {
    const eventStore = yield* EventStore
    const address = yield* Entity.CurrentAddress

    // Load state from event store
    const events = yield* eventStore.loadEvents(address.entityId)
    const state = MutableRef.make(replayEvents(events))

    return EventSourcedEntity.of({
      ApplyCommand: (env) => Effect.gen(function*() {
        const event = processCommand(MutableRef.get(state), env.payload.command)
        yield* eventStore.appendEvent(address.entityId, event)
        MutableRef.update(state, (s) => applyEvent(s, event))
        return event
      })
    })
  })
)
```

## Source Files Reference

Key implementation files in the repository:

| File | Description |
|------|-------------|
| `/packages/effect/src/unstable/cluster/Entity.ts` | Entity definition and client creation |
| `/packages/effect/src/unstable/cluster/EntityAddress.ts` | Entity addressing model |
| `/packages/effect/src/unstable/cluster/Sharding.ts` | Core sharding and entity management |
| `/packages/effect/src/unstable/cluster/internal/entityManager.ts` | Entity lifecycle management |
| `/packages/effect/src/unstable/cluster/internal/entityReaper.ts` | Idle entity cleanup |
| `/packages/effect/src/unstable/cluster/EntityResource.ts` | Keep-alive resource management |
| `/packages/effect/src/unstable/cluster/ClusterSchema.ts` | Annotation definitions |
| `/packages/effect/src/unstable/cluster/ShardingConfig.ts` | Configuration options |
| `/packages/effect/src/unstable/cluster/EntityProxy.ts` | RPC/HTTP entity exposure |
| `/packages/effect/test/cluster/Entity.test.ts` | Entity test examples |
| `/packages/effect/test/cluster/Sharding.test.ts` | Integration test examples |
| `/packages/effect/test/cluster/TestEntity.ts` | Test entity definition patterns |
