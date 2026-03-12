import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai'
import type {
  LLMChatOptions,
  LLMChatResult,
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.types.js'
import type { LLMProvider } from './llm.interface.js'

type Content = { role: 'user' | 'model'; parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } }> }

export function createGeminiProvider(apiKey: string): LLMProvider {
  const ai = new GoogleGenAI({ apiKey })

  function toGeminiContents(messages: LLMMessage[]): Content[] {
    const contents: Content[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        contents.push({ role: 'user', parts: [{ text: m.content }] })
        continue
      }
      if (m.toolResults?.length) {
        const parts = m.toolResults.map((r) => {
          let response: Record<string, unknown>
          try {
            response = JSON.parse(r.content) as Record<string, unknown>
          } catch {
            response = { result: r.content }
          }
          const fnName = r.name ?? `tool_${r.toolCallId}`
          return { functionResponse: { name: fnName, response } }
        })
        contents.push({ role: 'user', parts })
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts: Content['parts'] = m.content ? [{ text: m.content }] : []
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.input } })
        }
        contents.push({ role: 'model', parts })
      } else if (m.role === 'user' || m.role === 'assistant') {
        const role = m.role === 'assistant' ? 'model' : 'user'
        contents.push({ role, parts: [{ text: m.content }] })
      }
    }
    return contents
  }

  return {
    async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResult> {
      const contents = toGeminiContents(messages)
      const response = await ai.models.generateContent({
        model: options?.model ?? 'gemini-2.0-flash',
        contents: contents.length ? contents : [{ role: 'user', parts: [{ text: '' }] }],
        config: {
          maxOutputTokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0,
        },
      })

      const text = response.text ?? ''
      const usage = response.usageMetadata
      return {
        text,
        toolCalls: [],
        stopReason: response.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
        usage: usage
          ? { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 }
          : undefined,
      }
    },

    async chatWithTools(
      messages: LLMMessage[],
      tools: LLMToolDefinition[],
      options?: LLMChatOptions & { toolChoice?: 'auto' | 'required' },
    ): Promise<LLMChatResult> {
      const contents = toGeminiContents(messages)
      const functionDeclarations = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }))

      const config: Record<string, unknown> = {
        maxOutputTokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.3,
      }
      if (functionDeclarations.length) {
        config.tools = [{ functionDeclarations }]
        config.toolConfig = {
          functionCallingConfig:
            options?.toolChoice === 'required'
              ? { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: tools.map((t) => t.name) }
              : { mode: FunctionCallingConfigMode.AUTO },
        }
      }

      const response = await ai.models.generateContent({
        model: options?.model ?? 'gemini-2.0-flash',
        contents: contents.length ? contents : [{ role: 'user', parts: [{ text: '' }] }],
        config,
      })

      const text = response.text ?? ''
      const functionCalls = (response.functionCalls ?? []) as Array<{ name: string; args: Record<string, unknown> }>
      const toolCalls: LLMToolCall[] = functionCalls.map((fc, i) => ({
        id: `call_${i}`,
        name: fc.name,
        input: fc.args ?? {},
      }))

      const stopReason =
        response.candidates?.[0]?.finishReason === 'STOP' && toolCalls.length > 0
          ? 'tool_use'
          : response.candidates?.[0]?.finishReason === 'MAX_TOKENS'
            ? 'max_tokens'
            : toolCalls.length > 0
              ? 'tool_use'
              : 'end_turn'

      const usage = response.usageMetadata
      return {
        text,
        toolCalls,
        stopReason,
        usage: usage
          ? { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 }
          : undefined,
      }
    },
  }
}
