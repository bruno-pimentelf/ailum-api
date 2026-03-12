import Anthropic from '@anthropic-ai/sdk'
import type { LLMChatOptions, LLMChatResult, LLMMessage, LLMToolCall, LLMToolDefinition } from './llm.types.js'
import type { LLMProvider } from './llm.interface.js'

export function createAnthropicProvider(apiKey: string): LLMProvider {
  const client = new Anthropic({ apiKey })

  function toAnthropicMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = []
    for (const m of messages) {
      if (m.role === 'system') continue
      if (m.toolResults?.length) {
        out.push({
          role: 'user',
          content: m.toolResults.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
          })),
        })
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        out.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.toolCalls.map((tc) => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
          ],
        })
      } else {
        out.push({ role: m.role as 'user' | 'assistant', content: m.content })
      }
    }
    return out
  }

  function extractText(content: Anthropic.Message['content']): string {
    return content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }

  function extractToolCalls(content: Anthropic.Message['content']): LLMToolCall[] {
    return content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }))
  }

  return {
    async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResult> {
      const system = messages.find((m) => m.role === 'system')?.content
      const apiMessages = toAnthropicMessages(
        system ? messages.filter((m) => m.role !== 'system') : messages,
      )
      const response = await client.messages.create({
        model: options?.model ?? 'claude-haiku-4-5',
        max_tokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0,
        system: system ?? '',
        messages: apiMessages,
      })
      const text = extractText(response.content)
      const toolCalls = extractToolCalls(response.content)
      const stopReason =
        response.stop_reason === 'tool_use'
          ? 'tool_use'
          : response.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : 'end_turn'
      return {
        text,
        toolCalls,
        stopReason,
        usage: response.usage
          ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
          : undefined,
      }
    },

    async chatWithTools(
      messages: LLMMessage[],
      tools: LLMToolDefinition[],
      options?: LLMChatOptions & { toolChoice?: 'auto' | 'required' },
    ): Promise<LLMChatResult> {
      const system = messages.find((m) => m.role === 'system')?.content
      const apiMessages = toAnthropicMessages(
        system ? messages.filter((m) => m.role !== 'system') : messages,
      )
      const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool['input_schema'],
      }))
      const toolChoice =
        options?.toolChoice === 'required' ? { type: 'any' as const } : { type: 'auto' as const }

      const response = await client.messages.create({
        model: options?.model ?? 'claude-haiku-4-5',
        max_tokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.3,
        system: system ?? '',
        messages: apiMessages,
        tools: anthropicTools,
        tool_choice: toolChoice,
      })

      const text = extractText(response.content)
      const toolCalls = extractToolCalls(response.content)
      const stopReason =
        response.stop_reason === 'tool_use'
          ? 'tool_use'
          : response.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : 'end_turn'
      return {
        text,
        toolCalls,
        stopReason,
        usage: response.usage
          ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
          : undefined,
      }
    },
  }
}
