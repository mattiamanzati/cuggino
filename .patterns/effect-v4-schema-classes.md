# Effect v4 Schema Classes

## Basic Schema Class

For defining data classes with encoding/decoding support:

```typescript
import { Schema } from "effect"

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number
}) {}

// Usage - use `new` constructor
const user = new User({ id: "1", name: "John", age: 30 })

// Encoding/Decoding
const encoded = Schema.encodeSync(User)(user)
const decoded = Schema.decodeSync(User)(encoded)
```

## Tagged Schema Class (Discriminated Union)

For creating tagged classes that can be part of a discriminated union:

```typescript
import { Schema } from "effect"

class SystemMessage extends Schema.Class<SystemMessage>("SystemMessage")({
  _tag: Schema.tag("SystemMessage"),  // Adds literal _tag field
  text: Schema.String
}) {}

class AgentMessage extends Schema.Class<AgentMessage>("AgentMessage")({
  _tag: Schema.tag("AgentMessage"),
  text: Schema.String
}) {}

class ToolCall extends Schema.Class<ToolCall>("ToolCall")({
  _tag: Schema.tag("ToolCall"),
  name: Schema.String,
  input: Schema.Unknown
}) {}

// Union type
type Message = SystemMessage | AgentMessage | ToolCall

// Union schema for encoding/decoding - note the array syntax
const MessageSchema = Schema.Union([SystemMessage, AgentMessage, ToolCall])

// Usage
const msg = new SystemMessage({ text: "Hello" })
console.log(msg._tag) // "SystemMessage"
```

## Error Class

For defining typed errors with Schema support:

```typescript
import { Schema } from "effect"

class ValidationError extends Schema.ErrorClass<ValidationError>("ValidationError")({
  _tag: Schema.tag("ValidationError"),
  field: Schema.String,
  message: Schema.String
}) {}

class NetworkError extends Schema.ErrorClass<NetworkError>("NetworkError")({
  _tag: Schema.tag("NetworkError"),
  statusCode: Schema.Number
}) {}
```

## Optional Fields

```typescript
class Config extends Schema.Class<Config>("Config")({
  host: Schema.String,
  port: Schema.Number,
  timeout: Schema.optional(Schema.Number)  // Optional field
}) {}
```

## Array Fields

```typescript
class Batch extends Schema.Class<Batch>("Batch")({
  items: Schema.Array(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
}) {}
```

## Key Differences from Effect v3

1. **Schema.Union takes an array**: `Schema.Union([A, B, C])` not `Schema.Union(A, B, C)`
2. **Use `new` constructor**: Create instances with `new MyClass({ ... })` instead of factory functions
3. **Schema.tag helper**: Use `Schema.tag("TagName")` for the `_tag` field in tagged classes
