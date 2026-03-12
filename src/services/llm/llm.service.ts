import { env } from '../../config/env.js'
import type { LLMProvider } from './llm.interface.js'
import { createAnthropicProvider } from './llm-anthropic.provider.js'
import { createOpenAIProvider } from './llm-openai.provider.js'
import { createGeminiProvider } from './llm-gemini.provider.js'

/** Maps logical model names to provider-specific models */
export const LLM_MODEL_MAP = {
  anthropic: { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-4-5' },
  openai: { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o' },
  gemini: { haiku: 'gemini-2.0-flash', sonnet: 'gemini-2.0-flash-exp' },
} as const

export function resolveModel(size: 'haiku' | 'sonnet'): string {
  const provider = env.LLM_PROVIDER ?? 'anthropic'
  return LLM_MODEL_MAP[provider][size]
}

let _provider: LLMProvider | null = null

function getProvider(): LLMProvider {
  if (_provider) return _provider

  const provider = env.LLM_PROVIDER ?? 'anthropic'

  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai')
    }
    _provider = createOpenAIProvider(apiKey)
  } else if (provider === 'gemini') {
    const apiKey = env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini')
    }
    _provider = createGeminiProvider(apiKey)
  } else {
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic')
    }
    _provider = createAnthropicProvider(apiKey)
  }

  return _provider
}

/** Lazy singleton — use this for all LLM calls */
export function getLLM(): LLMProvider {
  return getProvider()
}
