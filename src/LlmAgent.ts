import { Effect, ServiceMap, Stream } from "effect"
import type { LlmAgentEvent, LlmSessionError } from "./LlmAgentEvent.js"

/**
 * Options for spawning an LLM agent session
 */
export interface LlmAgentSpawnOptions {
  /** Current working directory for the agent */
  readonly cwd: string
  /** The prompt to send to the agent */
  readonly prompt: string
  /** Optional system prompt to append */
  readonly systemPrompt?: string
  /** Skip permission checks (use with caution) */
  readonly dangerouslySkipPermissions?: boolean
  /** Session ID for the Claude CLI (--session-id <value>) */
  readonly sessionId?: string
  /** Resume an existing session by ID (--resume <value>) */
  readonly resumeSessionId?: string
}

/**
 * Options for running an interactive LLM agent session
 */
export interface LlmAgentInteractiveOptions {
  /** Current working directory for the agent */
  readonly cwd: string
  /** Optional system prompt to append */
  readonly systemPrompt?: string
  /** Skip permission checks (use with caution) */
  readonly dangerouslySkipPermissions?: boolean
}

/**
 * LLM Agent service shape
 */
export interface LlmAgentShape {
  /**
   * Spawn an LLM agent session and return a stream of events.
   * The stream fails with SessionError on error results from the agent.
   */
  readonly spawn: (
    options: LlmAgentSpawnOptions
  ) => Stream.Stream<LlmAgentEvent, LlmSessionError>
  /**
   * Run an interactive LLM agent session with stdio inherited.
   * Returns the process exit code.
   */
  readonly interactive: (
    options: LlmAgentInteractiveOptions
  ) => Effect.Effect<number, LlmSessionError>
}

/**
 * Abstract LLM Agent service
 *
 * This service provides an abstraction over different LLM backends.
 * Implementations (e.g., ClaudeLlmAgent) provide the concrete layer.
 */
export class LlmAgent extends ServiceMap.Service<LlmAgent, LlmAgentShape>()("LlmAgent") {}
