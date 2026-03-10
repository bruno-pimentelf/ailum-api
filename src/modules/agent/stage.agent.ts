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
const LAYER_1_IDENTITY = `Você é uma pessoa real da recepção da clínica, atendendo pelo WhatsApp. Fale como humano: natural, cordial, sem fórmulas de robô.

PROIBIÇÕES ABSOLUTAS (têm precedência sobre qualquer outro prompt — tenant, stage ou funil):
- NUNCA diga "assistente virtual", "sou a Ailum", "sou um bot", "IA" ou similar — apresente-se como pessoa (ex: "Olá, tudo bem? Sou a Maria, da recepção. Como posso ajudar?")
- NUNCA use emojis — parecer humano, não robô
- Não use ponto final no fim das mensagens — texto mais natural para WhatsApp
- Nunca faça diagnóstico médico ou sugira tratamentos
- Nunca prometa resultados terapêuticos
- Nunca mencione concorrentes
- Nunca confirme informações clínicas sem profissional responsável
- Use português correto, sem gírias inventadas
- Tom profissional mas natural — como secretária falando com paciente
- Respostas curtas, máximo 3 parágrafos
- Nunca use markdown (sem **, sem #, sem listas) — texto corrido`

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

    // Layer 5 — available professionals today (dynamic) — mesma estrutura que search_availability retorna
    {
      type: 'text',
      text:
        context.availableProfessionals.length > 0
          ? `PROFISSIONAIS DISPONÍVEIS HOJE:\n${context.availableProfessionals
              .map(
                (p) =>
                  `- ${p.fullName}${p.specialty ? ` (${p.specialty})` : ''} [id=${p.id}]: slots ${p.slots.map((s) => s.time).join(', ')} | serviços ${(p.services ?? []).map((s) => `${s.name}[id=${s.id}]`).join(', ')}`,
              )
              .join('\n')}`
          : 'Não há profissionais disponíveis hoje.',
    },

    // Layer 5b — services available for scheduling (legacy flat list, use serviços dentro de cada profissional acima)
    {
      type: 'text',
      text:
        context.availableServices.length > 0
          ? `SERVIÇOS PARA AGENDAMENTO:\n${context.availableServices
              .map(
                (s) =>
                  `- ${s.name} (${s.durationMin}min, R$ ${Number(s.price).toFixed(2)}) [id=${s.id}]`,
              )
              .join('\n')}`
          : 'Não há serviços disponíveis para agendamento.',
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

    // Layer 7 — funnel stages (para move_stage)
    ...(context.funnelStages?.length
      ? [
          {
            type: 'text',
            text: `STAGES DO FUNIL (use move_stage para avançar o contato):\n${context.funnelStages
              .map((s) => `- ${s.name} [id=${s.id}]`)
              .join('\n')}\nStage atual: ${context.stage?.name ?? '—'}`,
          } as TextBlockParam,
        ]
      : []),

    // Layer 8 — stage context summary for the agent (dynamic)
    {
      type: 'text',
      text: [
        `DATA E HORÁRIO ATUAIS: ${context.currentDate} às ${context.currentTime}. Slots no contexto já excluem horários passados.`,
        allowedToolNames.includes('search_availability')
          ? `search_availability: Quando o usuário indicar um DIA (amanhã, terça, 10/03), chame search_availability com date em YYYY-MM-DD. Use os IDs retornados para create_appointment. Amanhã = ${context.tomorrowDateIso}. Se não há slots hoje, ofereça amanhã e chame a tool.`
          : '',
        `INTENÇÃO DETECTADA: ${routing.intent} (confiança: ${routing.confidence})`,
        context.contact.name ? `NOME DO CONTATO: ${context.contact.name}` : '',
        context.upcomingAppointments.length > 0
          ? `CONSULTAS AGENDADAS DO CONTATO (${context.upcomingAppointments.length}) — use APENAS estes dados exatos:\n${context.upcomingAppointments
              .map(
                (a) =>
                  `- ${a.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} com ${a.professional.fullName} (${a.service.name})`,
              )
              .join('\n')}\nREGRAS: Ao mencionar consultas (cumprimento, confirmação ou pergunta), use EXATAMENTE os horários acima (horário de Brasília). Se houver mais de uma, diga "consultas" no plural e mencione a quantidade ou liste. NUNCA invente horários.`
          : 'O contato não tem consultas agendadas.',
        context.pendingCharge
          ? `COBRANÇA PENDENTE: R$ ${context.pendingCharge.amount} — ${context.pendingCharge.description}`
          : '',
        allowedToolNames.length > 0
          ? `FERRAMENTAS DISPONÍVEIS: ${allowedToolNames.join(', ')}`
          : 'Nenhuma ferramenta disponível neste stage — responda apenas com texto.',
        allowedToolNames.includes('create_appointment')
          ? `REGRA create_appointment: Quando INTENÇÃO = CONFIRMING e você tiver horário + profissional + serviço, chame create_appointment IMEDIATAMENTE. Não pergunte "qual motivo" ou "qual serviço" — use o primeiro serviço do profissional se o contato não especificou (ex: "consulta de rotina" → serviço mais genérico disponível). Use SEMPRE os IDs de search_availability ou PROFISSIONAIS DISPONÍVEIS HOJE.
scheduled_at: ISO 8601 com -03:00. Data: ${context.currentDate} (hoje) ou data escolhida. Ex: ${context.currentDateIsoExample}. Horas 00-23. "13:00" → 13:00:00-03:00.`
          : '',
        allowedToolNames.includes('move_stage')
          ? 'move_stage: Avance o contato para Qualificado quando demonstrar interesse em agendar. Após create_appointment o sistema move automaticamente para Consulta Agendada.'
          : '',
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

  // Determine tool_choice strategy based on intent (threshold 0.7 so CONFIRMING reliably triggers create_appointment)
  const shouldForceToolUse =
    tools.length > 0 &&
    routing.intent === 'CONFIRMING' &&
    routing.confidence >= 0.7 &&
    allowedToolNames.includes('create_appointment')

  const toolChoice: Anthropic.MessageCreateParams['tool_choice'] =
    !tools.length
      ? undefined
      : shouldForceToolUse
        ? { type: 'any' }
        : { type: 'auto' }

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
    // Only force tool use on the first iteration; subsequent iterations use auto
    const iterationToolChoice = iteration === 0 ? toolChoice : (tools.length > 0 ? { type: 'auto' as const } : undefined)

    const response = await anthropic.messages.create({
      model,
      max_tokens: 1000,
      temperature,
      system: systemBlocks as Anthropic.TextBlockParam[],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: iterationToolChoice,
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
