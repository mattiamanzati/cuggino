import { Effect } from "effect"
import type { LlmAgentShape } from "./LlmAgent.js"
import type { StorageServiceShape } from "./StorageService.js"

export interface RunTelegramPmOptions {
  readonly botToken: string
  readonly agent: LlmAgentShape
  readonly storage: StorageServiceShape
  readonly systemPrompt: string
}

export const runTelegramPm = (_options: RunTelegramPmOptions): Effect.Effect<void> =>
  Effect.void
