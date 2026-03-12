import type {
  LLMChatOptions,
  LLMChatResult,
  LLMMessage,
  LLMToolDefinition,
} from './llm.types.js'

export interface LLMProvider {
  /** Chat without tools — returns text only */
  chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResult>

  /** Chat with tools — returns text and optionally tool_calls */
  chatWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMChatOptions & { toolChoice?: 'auto' | 'required' },
  ): Promise<LLMChatResult>
}
