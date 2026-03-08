import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  TextBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.js'
import { env } from '../../config/env.js'
import { AGENT_TOOLS } from '../../constants/agent-tools.js'
import type { AgentContext } from '../../types/context.js'
import type { RouterResult } from './router.agent.js'
import type { ToolResult } from './tool-executor.js'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const MAX_TOOL_ITERATIONS = 5

// ─── Layer 1: Immutable identity & global guardrails (always cached) ─────────
const LAYER_1_IDENTITY = `Você é um assistente virtual de clínica médica no WhatsApp.

REGRAS GLOBAIS INVIOLÁVEIS:
- Nunca faça diagnóstico médico ou sugira tratamentos específicos
- Nunca prometa resultados terapêuticos
- Nunca mencione concorrentes
- Nunca confirme informações clínicas sem profissional responsável
- Mantenha tom profissional, empático e brasileiro (PT-BR informal)
- Respostas curtas e diretas — máximo 3 parágrafos no WhatsApp
- Nunca use markdown (sem **, sem #, sem listas com -) — use texto corrido
- Emojis com moderação: apenas 1 por mensagem, se adequado`

export interface ToolCallRecord {
  name: string
  input: Record<string, unknown>
  result: ToolResult
}

export interface StageAgentResult {
  reply: string
  toolCalls: ToolCallRecord[]
  requiresConfirmation: boolean
  inputTokens: number
  outputTokens: number
}

export async function runStageAgent(
  message: string,
  routing: RouterResult,
  context: AgentContext,
  executeToolFn: (toolName: string, input: Record<string, unknown>) => Promise<ToolResult>,
): Promise<StageAgentResult> {
  const config = context.stage?.agentConfig
  const allowedToolNames = config?.allowedTools ?? []
  const model = config?.model === 'HAIKU' ? 'claude-haiku-4-5' : 'claude-sonnet-4-5'
  const temperature = config?.temperature ?? 0.3

  // Build the layered system prompt
  const systemBlocks: TextBlockParam[] = [
    // Layer 1 — immutable identity (cached)
    {
      type: 'text',
      text: LAYER_1_IDENTITY,
      cache_control: { type: 'ephemeral' },
    } as TextBlockParam & { cache_control: { type: 'ephemeral' } },

    // Layer 2 — tenant agent base prompt (cached)
    ...(context.tenant.agentBasePrompt
      ? [
          {
            type: 'text',
            text: `IDENTIDADE DA CLÍNICA:\n${context.tenant.agentBasePrompt}`,
            cache_control: { type: 'ephemeral' },
          } as TextBlockParam & { cache_control: { type: 'ephemeral' } },
        ]
      : []),

    // Layer 3 — funnel agent personality + guardrail rules (cached)
    ...(config?.funnelAgentPersonality || context.tenant.guardrailRules
      ? [
          {
            type: 'text',
            text: [
              config?.funnelAgentName
                ? `NOME DO ASSISTENTE: ${config.funnelAgentName}`
                : '',
              config?.funnelAgentPersonality
                ? `PERSONALIDADE DO FUNIL:\n${config.funnelAgentPersonality}`
                : '',
              context.tenant.guardrailRules
                ? `REGRAS ESPECÍFICAS DA CLÍNICA:\n${context.tenant.guardrailRules}`
                : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
            cache_control: { type: 'ephemeral' },
          } as TextBlockParam & { cache_control: { type: 'ephemeral' } },
        ]
      : []),

    // Layer 4 — stage context (cached)
    ...(config?.stageContext
      ? [
          {
            type: 'text',
            text: `CONTEXTO DO STAGE ATUAL (${context.stage?.name}):\n${config.stageContext}`,
            cache_control: { type: 'ephemeral' },
          } as TextBlockParam & { cache_control: { type: 'ephemeral' } },
        ]
      : []),

    // Layer 5 — available professionals today (dynamic)
    {
      type: 'text',
      text:
        context.availableProfessionals.length > 0
          ? `PROFISSIONAIS DISPONÍVEIS HOJE:\n${context.availableProfessionals
              .map(
                (p) =>
                  `- ${p.fullName}${p.specialty ? ` (${p.specialty})` : ''}: ${p.slots.map((s) => s.time).join(', ')}`,
              )
              .join('\n')}`
          : 'Não há profissionais disponíveis hoje.',
    },

    // Layer 6 — contact memories (dynamic)
    ...(context.memories.length > 0
      ? [
          {
            type: 'text',
            text: `O QUE SABEMOS SOBRE ESTE CONTATO:\n${context.memories
              .map((m) => `- ${m.key}: ${m.value}`)
              .join('\n')}`,
          } as TextBlockParam,
        ]
      : []),

    // Layer 7 — stage context summary for the agent (dynamic)
    {
      type: 'text',
      text: [
        `INTENÇÃO DETECTADA: ${routing.intent} (confiança: ${routing.confidence})`,
        context.contact.name ? `NOME DO CONTATO: ${context.contact.name}` : '',
        context.nextAppointment
          ? `PRÓXIMA CONSULTA: ${context.nextAppointment.scheduledAt.toLocaleString('pt-BR')} com ${context.nextAppointment.professional.fullName}`
          : '',
        context.pendingCharge
          ? `COBRANÇA PENDENTE: R$ ${context.pendingCharge.amount} — ${context.pendingCharge.description}`
          : '',
        allowedToolNames.length > 0
          ? `FERRAMENTAS DISPONÍVEIS: ${allowedToolNames.join(', ')}`
          : 'Nenhuma ferramenta disponível neste stage — responda apenas com texto.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]

  // Build tools list — only allowed tools
  const tools: Anthropic.Tool[] = allowedToolNames
    .filter((name): name is keyof typeof AGENT_TOOLS => name in AGENT_TOOLS)
    .map((name) => {
      const def = AGENT_TOOLS[name]
      return {
        name: def.name,
        description: def.description,
        input_schema: def.input_schema as Anthropic.Tool['input_schema'],
      }
    })

  // Build conversation messages
  const conversationMessages: MessageParam[] = [
    ...context.messages.slice(-10).map(
      (m): MessageParam => ({
        role: m.role === 'CONTACT' ? 'user' : 'assistant',
        content: m.content,
      }),
    ),
    { role: 'user', content: message },
  ]

  // Tool loop
  const toolCalls: ToolCallRecord[] = []
  let requiresConfirmation = false
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let currentMessages: MessageParam[] = [...conversationMessages]
  let finalReply = ''

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1000,
      temperature,
      system: systemBlocks as Anthropic.TextBlockParam[],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? { type: 'auto' } : undefined,
      messages: currentMessages,
    })

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // Collect text reply
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    if (textContent) {
      finalReply = textContent
    }

    // Stop if no tool calls
    if (response.stop_reason !== 'tool_use') {
      break
    }

    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    )

    if (toolUseBlocks.length === 0) break

    // Add assistant turn to messages
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content } as MessageParam,
    ]

    // Execute each tool
    const toolResultContents: Anthropic.ToolResultBlockParam[] = []

    for (const toolBlock of toolUseBlocks) {
      const toolInput = toolBlock.input as Record<string, unknown>
      const result = await executeToolFn(toolBlock.name, toolInput)

      toolCalls.push({ name: toolBlock.name, input: toolInput, result })

      toolResultContents.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify(result),
      })

      // Stop for confirmation if needed
      if (result.requiresConfirmation) {
        requiresConfirmation = true
      }
    }

    // Add tool results to messages
    currentMessages = [
      ...currentMessages,
      { role: 'user', content: toolResultContents } as MessageParam,
    ]

    // If any tool requires confirmation, stop the loop
    if (requiresConfirmation) {
      break
    }
  }

  return {
    reply: finalReply,
    toolCalls,
    requiresConfirmation,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  }
}
