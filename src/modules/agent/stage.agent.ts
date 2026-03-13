import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import { AGENT_TOOLS } from '../../constants/agent-tools.js'
import { getLLM, resolveModel } from '../../services/llm/llm.service.js'
import type { LLMMessage, LLMToolCall } from '../../services/llm/llm.types.js'
import { toLLMTool } from '../../services/llm/typebox-to-json-schema.js'
import type { AgentContext } from '../../types/context.js'
import type { RouterResult } from './router.agent.js'
import type { ToolResult } from './tool-executor.js'

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
  const rawAllowedTools = config?.allowedTools ?? []
  const requirePaymentBefore = config?.requirePaymentBeforeConfirm ?? false
  const allowedToolNames = requirePaymentBefore
    ? rawAllowedTools.filter((t) => t !== 'create_appointment')
    : rawAllowedTools
  const model = resolveModel(config?.model === 'HAIKU' ? 'haiku' : 'sonnet')
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
          ? `search_availability: (1) Quando o usuário indicar um DIA (amanhã, terça, 10/03), chame com date em YYYY-MM-DD. (2) QUANDO O USUÁRIO PERGUNTAR SEM ESPECIFICAR DATA — "quais você tem?", "quais dias tem?", "o que tem disponível?", "quando pode?" — chame IMEDIATAMENTE com amanhã (${context.tomorrowDateIso}); se retornar 0 profissionais, tente depois de amanhã (${context.dayAfterTomorrowDateIso}). NUNCA diga "não tem horários configurados" ou "agenda fechada" SEM ter chamado a tool. (3) APRESENTE A DISPONIBILIDADE DE FORMA COMPLETA: data (ex: "amanhã 12/03"), profissional, e todos os horários listados (ex: "09:00, 09:30, 10:00, 10:30, 11:00, 11:30 e 12:00"). Use o retorno da tool — dateFormatted, professionals[].fullName, professionals[].slots[].time. Amanhã = ${context.tomorrowDateIso}. IDs do retorno são usados em create_appointment.`
          : '',
        `INTENÇÃO DETECTADA: ${routing.intent} (confiança: ${routing.confidence})`,
        context.contact.name ? `NOME DO CONTATO: ${context.contact.name}` : '',
        context.upcomingAppointments.length > 0
          ? `CONSULTAS AGENDADAS DO CONTATO (${context.upcomingAppointments.length}) — use APENAS estes dados exatos. Para cancel_appointment e reschedule_appointment use o id:\n${context.upcomingAppointments
              .map(
                (a) =>
                  `- id=${a.id} | ${a.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} com ${a.professional.fullName} (${a.service.name})`,
              )
              .join('\n')}\nREGRAS: Ao mencionar consultas, use EXATAMENTE os horários acima (horário de Brasília). Para cancelar ou remarcar, use o appointment_id da lista. NUNCA invente horários.`
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
        allowedToolNames.includes('reschedule_appointment')
          ? `REGRA reschedule_appointment: Quando INTENÇÃO = WANTS_RESCHEDULE e o contato especificou qual consulta remarcar e para quando, chame reschedule_appointment IMEDIATAMENTE com appointment_id (da lista de consultas) e scheduled_at (ISO com -03:00). NUNCA diga que remarcou sem ter chamado a tool — só envie confirmação após o resultado da tool.`
          : '',
        allowedToolNames.includes('cancel_appointment')
          ? `REGRA cancel_appointment: Quando INTENÇÃO = WANTS_CANCEL e o contato especificou qual consulta cancelar, chame cancel_appointment IMEDIATAMENTE com appointment_id. NUNCA diga que cancelou sem ter chamado a tool.`
          : '',
        requirePaymentBefore && allowedToolNames.includes('generate_pix')
          ? `REGRA PIX ANTES DE AGENDAR: Este stage exige pagamento PIX ANTES de criar a consulta. NUNCA chame create_appointment. FLUXO: (1) Quando o contato escolher horário, peça o CPF antes de gerar o PIX. (2) Assim que o contato informar o CPF, chame generate_pix IMEDIATAMENTE com: professional_id, service_id, scheduled_at (ISO com -03:00), amount (price do serviço), description, cpf (11 dígitos). Use IDs de search_availability. A consulta será criada automaticamente APENAS após o pagamento.`
          : '',
        `REGRA WANTS_INFO + consultas: Quando INTENÇÃO = WANTS_INFO e o contato pedir ver/listar "minhas consultas", "meus agendamentos" ou similar, as consultas JÁ ESTÃO no bloco CONSULTAS AGENDADAS acima. Responda DIRETAMENTE listando-as (formato dia/hora + profissional + serviço). NUNCA diga "estamos verificando" — os dados estão no contexto. Se send_message estiver disponível, use-a para enviar a lista.`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]

  // Build tools list
  const llmTools = allowedToolNames
    .filter((name): name is keyof typeof AGENT_TOOLS => name in AGENT_TOOLS)
    .map((name) => toLLMTool(AGENT_TOOLS[name]))

  const shouldForceToolUse =
    llmTools.length > 0 &&
    routing.confidence >= 0.7 &&
    ((routing.intent === 'CONFIRMING' &&
      (requirePaymentBefore ? allowedToolNames.includes('generate_pix') : allowedToolNames.includes('create_appointment'))) ||
      (routing.intent === 'WANTS_RESCHEDULE' && allowedToolNames.includes('reschedule_appointment')) ||
      (routing.intent === 'WANTS_CANCEL' && allowedToolNames.includes('cancel_appointment')))

  const systemText = systemBlocks.map((b) => (b as { text: string }).text).join('\n\n')

  const conversationMessages: LLMMessage[] = [
    ...context.messages.slice(-10).map(
      (m): LLMMessage => ({
        role: m.role === 'CONTACT' ? 'user' : 'assistant',
        content: m.content,
      }),
    ),
    { role: 'user', content: message },
  ]

  const toolCalls: ToolCallRecord[] = []
  let requiresConfirmation = false
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let currentMessages: LLMMessage[] = [...conversationMessages]
  let finalReply = ''

  const llm = getLLM()

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const toolChoice = iteration === 0 && shouldForceToolUse ? 'required' : 'auto'

    const result = await llm.chatWithTools(
      [{ role: 'system', content: systemText }, ...currentMessages],
      llmTools,
      {
        model,
        maxTokens: 1000,
        temperature,
        toolChoice: llmTools.length ? toolChoice : undefined,
      },
    )

    totalInputTokens += result.usage?.inputTokens ?? 0
    totalOutputTokens += result.usage?.outputTokens ?? 0

    if (result.text) finalReply = result.text

    if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) break

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: result.text,
        toolCalls: result.toolCalls,
      },
    ]

    const toolResultContents: { toolCallId: string; content: string; name?: string }[] = []

    for (const tc of result.toolCalls as LLMToolCall[]) {
      const res = await executeToolFn(tc.name, tc.input)
      toolCalls.push({ name: tc.name, input: tc.input, result: res })
      toolResultContents.push({ toolCallId: tc.id, content: JSON.stringify(res), name: tc.name })
      if (res.requiresConfirmation) requiresConfirmation = true
    }

    currentMessages = [
      ...currentMessages,
      { role: 'user', content: '', toolResults: toolResultContents },
    ]

    if (requiresConfirmation) break
  }

  return {
    reply: finalReply,
    toolCalls,
    requiresConfirmation,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  }
}
