import { Effect } from "effect"
import type { LlmAgentShape } from "./LlmAgent.js"
import type { StorageServiceShape } from "./StorageService.js"

export interface RunTelegramPmOptions {
  readonly botToken: string
  readonly agent: LlmAgentShape
  readonly storage: StorageServiceShape
  readonly systemPrompt: string
}

export const splitMessage = (text: string, limit: number = 4096): Array<string> => {
  if (text.length <= limit) return [text]

  const chunks: Array<string> = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    const slice = remaining.slice(0, limit)

    // Try splitting at last \n\n boundary
    const doubleNewline = slice.lastIndexOf("\n\n")
    if (doubleNewline > 0) {
      chunks.push(remaining.slice(0, doubleNewline))
      remaining = remaining.slice(doubleNewline + 2)
      continue
    }

    // Try splitting at last \n boundary
    const singleNewline = slice.lastIndexOf("\n")
    if (singleNewline > 0) {
      chunks.push(remaining.slice(0, singleNewline))
      remaining = remaining.slice(singleNewline + 1)
      continue
    }

    // Hard-cut at limit
    chunks.push(slice)
    remaining = remaining.slice(limit)
  }

  return chunks
}

export const runTelegramPm = (_options: RunTelegramPmOptions): Effect.Effect<void> =>
  Effect.void
