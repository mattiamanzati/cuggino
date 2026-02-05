# Resource Management

## Overview

When code creates something that must be cleaned up later (a worktree, a temp file, a session), use `Effect.acquireRelease` to guarantee cleanup runs regardless of success or failure.

## `Effect.acquireRelease`

Pairs a resource acquisition with a release function. The release is guaranteed to run when the enclosing `Scope` is closed — even on failure or interruption.

```typescript
import { Effect, Exit } from "effect"

const worktree = Effect.acquireRelease(
  // acquire — create the resource
  createWorktree(fromBranch, sessionId),
  // release — clean up (receives exit status)
  (info, exit) => removeWorktree(info.worktreePath).pipe(Effect.ignore)
)
```

**Signature:**

```typescript
Effect.acquireRelease<A, E, R>(
  acquire: Effect<A, E, R>,
  release: (a: A, exit: Exit<unknown, unknown>) => Effect<unknown>
): Effect<A, E, R | Scope>
```

- `acquire` runs uninterruptibly
- `release` receives the acquired value and the `Exit` (success/failure/interruption)
- The returned effect requires a `Scope` in its context

## `Scope` and `Effect.scoped`

`acquireRelease` adds `Scope` to the effect's requirements. Use `Effect.scoped` to provide and close that scope automatically:

```typescript
const program = Effect.scoped(
  Effect.gen(function*() {
    const info = yield* worktree   // acquire runs here
    yield* doWork(info)            // use the resource
    return result
  })
  // release runs here — when the scope closes
)
```

`Effect.scoped`:
1. Creates a new `Scope`
2. Runs the effect with that scope
3. Closes the scope when the effect completes (success, failure, or interruption)
4. Removes `Scope` from the effect's requirements

## Nested Resources

Multiple `acquireRelease` calls in the same scope are released in **reverse order** (LIFO):

```typescript
const program = Effect.scoped(
  Effect.gen(function*() {
    const session = yield* acquireSession()     // acquired first
    const worktree = yield* acquireWorktree()   // acquired second
    yield* runLoop(worktree, session)
  })
  // worktree released first, then session
)
```

## `Effect.ensuring`

Simpler alternative when you don't need the resource value or exit status — just need to guarantee a finalizer runs:

```typescript
const program = doWork().pipe(
  Effect.ensuring(cleanup())
)
```

Use `ensuring` for fire-and-forget cleanup. Use `acquireRelease` when the cleanup depends on the acquired resource.

## When to Use What

| Pattern | Use When |
|---------|----------|
| `acquireRelease` | Cleanup depends on the acquired resource (worktree path, session ID, file handle) |
| `ensuring` | Cleanup is independent of the result (log a message, flush a buffer) |

## Anti-Pattern: Manual Cleanup

Do **not** manually clean up resources in a finally-style block:

```typescript
// BAD — cleanup skipped on interruption or unexpected errors
const info = yield* createWorktree(branch, id)
yield* doWork(info)
yield* removeWorktree(info.worktreePath)
```

```typescript
// GOOD — cleanup guaranteed
const info = yield* Effect.acquireRelease(
  createWorktree(branch, id),
  (info) => removeWorktree(info.worktreePath).pipe(Effect.ignore)
)
yield* doWork(info)
```

## Real Examples

### Worktree with Scope

```typescript
const acquireWorktree = (fromBranch: string, sessionId: string) =>
  Effect.acquireRelease(
    git.createWorktree(fromBranch, sessionId),
    (info) => git.removeWorktree(info.worktreePath).pipe(Effect.ignore)
  )
```

### Session Files with Scope

```typescript
const acquireSession = () =>
  Effect.acquireRelease(
    session.create(),
    (sessionId) => session.cleanup(sessionId).pipe(Effect.ignore)
  )
```

### Composing Both

```typescript
const program = Effect.scoped(
  Effect.gen(function*() {
    const sessionId = yield* acquireSession()
    const worktree = yield* acquireWorktree(fromBranch, sessionId)
    yield* runLoop({ sessionId, cwd: worktree.worktreePath })
  })
)
// Both worktree and session are cleaned up when the scope closes
```
