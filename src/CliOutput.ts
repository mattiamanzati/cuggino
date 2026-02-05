import { DateTime, Effect, Ref, Stream } from "effect"
import type { LlmAgentEvent } from "./LlmAgentEvent.js"
import type { LlmMarkerEvent } from "./LlmMarkerEvent.js"
import { isLlmMarkerEvent } from "./LlmMarkerEvent.js"
import { isLoopPhaseEvent, type LoopPhaseEvent, type LoopEvent } from "./LoopEvent.js"
import { isWatchLoopEvent, type WatchLoopEvent } from "./WatchLoopEvent.js"

export type PrintableEvent = LoopEvent | WatchLoopEvent

// ANSI escape codes for colors and formatting
const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const BLUE = "\x1b[34m"
const MAGENTA = "\x1b[35m"
const CYAN = "\x1b[36m"
const BOLD_MAGENTA = "\x1b[1;35m"
const BOLD_RED = "\x1b[1;31m"
const DIM_CYAN = "\x1b[2;36m"

// Spinner characters (braille pattern)
const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * State for the activity spinner
 */
export interface SpinnerState {
  readonly lastOutputWasSpinner: boolean
  readonly lastRealEventTime: DateTime.Utc
  readonly spinnerIndex: number
}

/**
 * Create initial spinner state
 */
export const makeSpinnerState = (): SpinnerState => ({
  lastOutputWasSpinner: false,
  lastRealEventTime: DateTime.nowUnsafe(),
  spinnerIndex: 0
})

/**
 * Truncate a string to a max length with "..." suffix
 */
const truncate = (str: string, maxLength: number): string =>
  str.length > maxLength ? str.slice(0, maxLength) + "..." : str

/**
 * Extract and format the most relevant parameter for a tool call
 */
export const formatToolParameters = (toolName: string, input: unknown): string => {
  if (typeof input !== "object" || input === null) return ""

  const obj = input as Record<string, unknown>
  let value: string | undefined

  switch (toolName) {
    case "Bash":
      value = typeof obj.command === "string" ? obj.command : undefined
      break
    case "Read":
    case "Write":
    case "Edit":
      value = typeof obj.file_path === "string" ? obj.file_path : undefined
      break
    case "Glob":
    case "Grep":
      value = typeof obj.pattern === "string" ? obj.pattern : undefined
      break
    case "WebFetch":
      value = typeof obj.url === "string" ? obj.url : undefined
      break
    case "Task":
      value = typeof obj.description === "string" ? obj.description
        : typeof obj.prompt === "string" ? obj.prompt
        : undefined
      break
    default:
      // For unknown tools, show first string value found
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === "string") {
          value = obj[key] as string
          break
        }
      }
  }

  if (value && typeof value === "string") {
    return `: ${truncate(value, 100)}`
  }

  return ""
}

/**
 * Format tool result output with line numbers
 */
const formatToolResult = (output: string, maxLines: number = 5): string => {
  const lines = output.split("\n")
  const totalLines = lines.length

  if (totalLines <= maxLines) {
    return lines
      .map((line, i) => `  ${String(i + 1).padStart(3)}→${line}`)
      .join("\n")
  }

  // Show first few lines with "..." indicator
  const visibleLines = lines.slice(0, maxLines)
  const formatted = visibleLines
    .map((line, i) => `  ${String(i + 1).padStart(3)}→${line}`)
    .join("\n")

  return `${formatted}\n  ...\n  (showing ${maxLines} of ${totalLines} lines)`
}

/**
 * Format elapsed time for spinner display
 */
const formatElapsed = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Format an LLM agent event for console output with colors
 */
export const formatLlmAgentEvent = (event: LlmAgentEvent): string | null => {
  switch (event._tag) {
    case "SystemMessage":
      return `${DIM}[System] ${event.text}${RESET}`
    case "AgentMessage":
      return `${DIM}${event.text}${RESET}`
    case "UserMessage":
      return `${DIM}[User] ${event.text}${RESET}`
    case "ToolCall":
      return `${DIM_CYAN}▶ ${event.name}${formatToolParameters(event.name, event.input)}${RESET}`
    case "ToolResult":
      return `${DIM}${formatToolResult(event.output)}${RESET}`
    case "PingEvent":
      return null
  }
}

/**
 * Format an LLM marker event for console output with colors
 */
export const formatLlmMarkerEvent = (event: LlmMarkerEvent): string => {
  switch (event._tag) {
    case "Note":
      return `\n${BOLD}${YELLOW}[NOTE]${RESET} ${event.content}\n`
    case "SpecIssue":
      return `\n${BOLD}${RED}[SPEC_ISSUE]${RESET} ${event.content}\n`
    case "Progress":
      return `\n${BOLD}${BLUE}[PROGRESS]${RESET} ${event.content}\n`
    case "Done":
      return `\n${BOLD}${GREEN}[DONE]${RESET} ${event.content}\n`
    case "Approved":
      return `\n${BOLD}${GREEN}[APPROVED]${RESET} ${event.content}\n`
    case "RequestChanges":
      return `\n${BOLD}${YELLOW}[REQUEST_CHANGES]${RESET} ${event.content}\n`
    case "PlanComplete":
      return `\n${BOLD}${GREEN}[PLAN_COMPLETE]${RESET} ${event.content}\n`
    case "ToBeDiscussed":
      return `\n${BOLD}${MAGENTA}[TO_BE_DISCUSSED]${RESET} ${event.content}\n`
  }
}

/**
 * Format spinner output
 */
export const formatSpinner = (elapsed: number, spinnerIndex: number): string => {
  const spinnerChar = SPINNER_CHARS[spinnerIndex % SPINNER_CHARS.length]
  const safeElapsed = Math.abs(elapsed)
  if (safeElapsed < 1) {
    return `${spinnerChar} Working...`
  }
  return `${spinnerChar} Working... (${formatElapsed(safeElapsed)})`
}

/**
 * ANSI escape sequence to clear the current line and return cursor to start
 */
export const CLEAR_LINE = "\x1b[2K\r"

/**
 * Format a LoopPhaseEvent for console output
 */
export const formatLoopPhaseEvent = (event: LoopPhaseEvent): string => {
  switch (event._tag) {
    case "IterationStart":
      return `\n${BOLD}[Loop] === Iteration ${event.iteration}/${event.maxIterations} ===${RESET}`
    case "PlanningStart":
      return `\n${DIM}[Planning] Starting...${RESET}`
    case "ImplementingStart":
      return `\n${DIM}[Implementing] Starting...${RESET}`
    case "ReviewingStart":
      return `\n${DIM}[Reviewing] Starting...${RESET}`
    case "CheckCommandOutput": {
      const truncated = event.output.length > 500
        ? event.output.slice(0, 500) + "..."
        : event.output
      return `${DIM}[Check] Output:\n${truncated}${RESET}`
    }
    case "LoopApproved":
      return `\n${BOLD}${GREEN}[Loop] Implementation approved!${RESET}`
    case "LoopSpecIssue":
      return `\n${BOLD}${RED}[Loop] Spec issue: ${event.content}${RESET}\nSaved to: ${event.filename}`
    case "LoopMaxIterations":
      return `\n${BOLD}${YELLOW}[Loop] Max iterations (${event.maxIterations}) reached${RESET}`
    case "CommitPerformed":
      return `\n${BOLD_MAGENTA}[Commit] ${event.commitHash}: ${event.message}${RESET}`
    case "CommitFailed":
      return `\n${BOLD_RED}[Commit] Failed: ${event.message}${RESET}`
  }
}

/**
 * Format a WatchLoopEvent for console output
 */
export const formatWatchLoopEvent = (event: WatchLoopEvent): string => {
  switch (event._tag) {
    case "WatchBacklogEmpty":
      return `${DIM}[Watch] Backlog empty, watching for new items...${RESET}\x07`
    case "WatchChangeDetected":
      return `${DIM}[Watch] Change detected, debouncing...${RESET}`
    case "WatchDebounceComplete":
      return `${DIM}[Watch] Debounce complete, checking folder...${RESET}`
    case "WatchProcessingItem":
      return `${DIM}[Watch] Processing: ${event.filename}${RESET}`
    case "WatchItemCompleted":
      return `${DIM}[Watch] Completed: ${event.filename}${RESET}`
    case "WatchSpecIssueWaiting":
      return `${DIM}[Watch] Spec issue detected, waiting for resolution...${RESET}`
    case "WatchAuditStarted":
      return `${CYAN}[Watch] Starting audit agent...${RESET}`
    case "WatchAuditEnded":
      return `${CYAN}[Watch] Audit agent finished.${RESET}`
    case "WatchAuditInterrupted":
      return `${CYAN}[Watch] Audit agent interrupted, work arrived.${RESET}`
    case "WatchTbdItemFound":
      return `${BOLD_MAGENTA}[Watch] TBD item found: ${event.filename}${RESET}`
  }
}

/**
 * Shared helper that computes the CLI output string for an event and updates spinner state.
 * Returns the string to output, or null if there is nothing to output.
 */
const computeEventOutput = (
  event: PrintableEvent,
  spinnerState: Ref.Ref<SpinnerState>
): Effect.Effect<string | null> =>
  Effect.gen(function*() {
    const state = yield* Ref.get(spinnerState)

    if (event._tag === "PingEvent") {
      const now = DateTime.nowUnsafe()
      const rawDistance = DateTime.distance(now, state.lastRealEventTime)
      const elapsedMs = Math.max(0, Math.abs(rawDistance))
      const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000))

      const prefix = state.lastOutputWasSpinner ? CLEAR_LINE : ""
      const spinnerOutput = formatSpinner(elapsedSeconds, state.spinnerIndex)

      yield* Ref.set(spinnerState, {
        ...state,
        lastOutputWasSpinner: true,
        spinnerIndex: (state.spinnerIndex + 1) % 10
      })

      return prefix + spinnerOutput
    } else {
      const prefix = state.lastOutputWasSpinner ? CLEAR_LINE : ""
      const formatted = isWatchLoopEvent(event)
        ? formatWatchLoopEvent(event)
        : isLoopPhaseEvent(event)
          ? formatLoopPhaseEvent(event)
          : isLlmMarkerEvent(event)
            ? formatLlmMarkerEvent(event as LlmMarkerEvent)
            : formatLlmAgentEvent(event as LlmAgentEvent)

      yield* Ref.set(spinnerState, {
        ...state,
        lastOutputWasSpinner: false,
        lastRealEventTime: DateTime.nowUnsafe()
      })

      if (formatted !== null) {
        const output = formatted.endsWith("\n") ? formatted : formatted + "\n"
        return prefix + output
      }

      return prefix || null
    }
  })

/**
 * Pure stream combinator that transforms LoopEvents into formatted CLI output strings.
 * Manages spinner state internally. Events that produce no output are filtered out.
 * Each emitted string is a complete output fragment (may or may not include trailing newline).
 */
export const formatCliOutput = <E, R>(
  stream: Stream.Stream<PrintableEvent, E, R>
): Stream.Stream<string, E, R> =>
  Stream.unwrap(
    Effect.gen(function*() {
      const spinnerState = yield* Ref.make<SpinnerState>(makeSpinnerState())

      return stream.pipe(
        Stream.mapEffect((event) => computeEventOutput(event, spinnerState)),
        Stream.filter((s): s is string => s !== null && s !== "")
      )
    })
  )

/**
 * Stream combinator that adds CLI output (spinner + formatting) as a side effect.
 * Events pass through unchanged.
 */
export const withCliOutput = <X extends PrintableEvent, E, R>(
  stream: Stream.Stream<X, E, R>
): Stream.Stream<X, E, R> =>
  Stream.unwrap(
    Effect.gen(function*() {
      const spinnerState = yield* Ref.make<SpinnerState>(makeSpinnerState())

      return stream.pipe(
        Stream.mapEffect((event) =>
          Effect.gen(function*() {
            const output = yield* computeEventOutput(event, spinnerState)
            if (output !== null && output !== "") {
              yield* Effect.sync(() => process.stdout.write(output))
            }
            return event
          })
        )
      )
    })
  )

// Re-export for convenience
export { DIM, RESET }
