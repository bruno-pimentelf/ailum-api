import OpenAI from 'openai'
import type {
  LLMChatOptions,
  LLMChatResult,
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.types.js'
import type { LLMProvider } from './llm.interface.js'

export function createOpenAIProvider(apiKey: string): LLMProvider {
  const client = new OpenAI({ apiKey })

  function toOpenAIMessages(messages: LLMMessage[]): OpenAI.ChatCompletionMessageParam[] {
    const out: OpenAI.ChatCompletionMessageParam[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        out.push({ role: 'system', content: m.content })
        continue
      }
      if (m.toolResults?.length) {
        for (const r of m.toolResults) {
          out.push({ role: 'tool' as const, tool_call_id: r.toolCallId, content: r.content })
        }
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        })
      } else if (m.role === 'user' || m.role === 'assistant') {
        out.push({ role: m.role, content: m.content })
      }
    }
    return out
  }

  return {
    async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResult> {
      const apiMessages = toOpenAIMessages(messages)
      const response = await client.chat.completions.create({
        model: options?.model ?? 'gpt-4o-mini',
        max_tokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0,
        messages: apiMessages,
      })
      const choice = response.choices[0]
      const text = choice?.message?.content ?? ''
      const usage = response.usage
      return {
        text,
        toolCalls: [],
        stopReason: choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
        usage: usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
          : undefined,
      }
    },

    async chatWithTools(
      messages: LLMMessage[],
      tools: LLMToolDefinition[],
      options?: LLMChatOptions & { toolChoice?: 'auto' | 'required' },
    ): Promise<LLMChatResult> {
      const apiMessages = toOpenAIMessages(messages)
      const functions: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }))

      const response = await client.chat.completions.create({
        model: options?.model ?? 'gpt-4o-mini',
        max_tokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.3,
        messages: apiMessages,
        tools: functions.length ? functions : undefined,
        tool_choice: functions.length && options?.toolChoice === 'required' ? 'required' : 'auto',
      })

      const choice = response.choices[0]
      const msg = choice?.message
      const text = msg?.content ?? ''
      const toolCalls: LLMToolCall[] = (msg?.tool_calls ?? []).map((tc: { id: string; function?: { name?: string; arguments?: string } }) => ({
        id: tc.id,
        name: tc.function?.name ?? '',
        input: (() => {
          try {
            return JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>
          } catch {
            return {}
          }
        })(),
      }))
      const usage = response.usage
      const stopReason =
        choice?.finish_reason === 'tool_calls'
          ? 'tool_use'
          : choice?.finish_reason === 'length'
            ? 'max_tokens'
            : 'end_turn'

      return {
        text,
        toolCalls,
        stopReason,
        usage: usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
          : undefined,
      }
    },
  }
}
