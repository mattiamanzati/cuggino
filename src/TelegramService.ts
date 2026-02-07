import { Data, Effect } from "effect"

// --- Error ---

export class TelegramError extends Data.TaggedError("TelegramError")<{
  readonly reason: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `Telegram API error: ${this.reason}`
  }
}

// --- Minimal Telegram API types ---

export interface TelegramChat {
  readonly id: number
}

export interface TelegramMessage {
  readonly message_id: number
  readonly chat: TelegramChat
  readonly text?: string
}

export interface TelegramUpdate {
  readonly update_id: number
  readonly message?: TelegramMessage
}

// --- API helpers ---

const apiUrl = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`

const postJson = (
  token: string,
  method: string,
  body: Record<string, unknown>
): Effect.Effect<unknown, TelegramError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(apiUrl(token, method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
      const json = await response.json() as { ok: boolean; result?: unknown; description?: string }
      if (!json.ok) {
        throw new Error(json.description ?? "Unknown Telegram API error")
      }
      return json.result
    },
    catch: (cause) =>
      new TelegramError({
        reason: cause instanceof Error ? cause.message : `${method} failed`,
        cause
      })
  })

// --- Public API functions ---

export const getUpdates = (
  token: string,
  offset: number,
  timeout: number
): Effect.Effect<Array<TelegramUpdate>, TelegramError> =>
  postJson(token, "getUpdates", {
    offset,
    timeout,
    allowed_updates: ["message"]
  }) as Effect.Effect<Array<TelegramUpdate>, TelegramError>

export const sendMessage = (
  token: string,
  chatId: number,
  text: string
): Effect.Effect<TelegramMessage, TelegramError> =>
  postJson(token, "sendMessage", {
    chat_id: chatId,
    text
  }) as Effect.Effect<TelegramMessage, TelegramError>

export const sendChatAction = (
  token: string,
  chatId: number,
  action: string
): Effect.Effect<boolean, TelegramError> =>
  postJson(token, "sendChatAction", {
    chat_id: chatId,
    action
  }) as Effect.Effect<boolean, TelegramError>
