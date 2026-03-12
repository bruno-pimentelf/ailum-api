/** Message format provider-agnostic */
export type LLMMessageRole = 'system' | 'user' | 'assistant'

export interface LLMMessage {
  role: LLMMessageRole
  content: string
  /** For assistant messages in history (after tool use) */
  toolCalls?: LLMToolCall[]
  /** For user messages that are tool results */
  toolResults?: LLMToolResult[]
}

export interface LLMToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMToolResult {
  toolCallId: string
  content: string
  /** Function name (for Gemini compatibility) */
  name?: string
}

/** Tool definition for function calling */
export interface LLMToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface LLMChatOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface LLMChatResult {
  text: string
  toolCalls: LLMToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage?: { inputTokens: number; outputTokens: number }
}
