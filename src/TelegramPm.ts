import { Effect } from "effect"
import { getUpdates, sendMessage, sendChatAction, type TelegramError } from "./TelegramService.js"
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

export const makeTypingIndicator = (token: string, chatId: number) => {
  let lastSent = 0
  return {
    send: Effect.gen(function*() {
      const now = Date.now()
      if (now - lastSent < 3000) return
      yield* sendChatAction(token, chatId, "typing").pipe(Effect.ignore)
      lastSent = now
    })
  }
}

export const authenticate = (token: string): Effect.Effect<{ chatId: number; offset: number }, TelegramError> =>
  Effect.gen(function*() {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    process.stdout.write(`Auth code: ${code} — enter this in the Telegram chat to authenticate\n`)

    let offset = 0
    while (true) {
      const updates = yield* getUpdates(token, offset, 30)
      for (const update of updates) {
        offset = update.update_id + 1
        if (update.message?.text?.trim() === code) {
          yield* sendMessage(token, update.message.chat.id, "Authenticated! You can now send messages.")
          return { chatId: update.message.chat.id, offset }
        }
      }
    }
  })

export const runTelegramPm = (_options: RunTelegramPmOptions): Effect.Effect<void> =>
  Effect.void
