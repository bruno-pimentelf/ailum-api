import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import { AILUM_AI_AVAILABILITY_TOOLS } from '../../constants/ailum-ai-availability-tools.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { getLLM, resolveModel } from '../../services/llm/llm.service.js'
import type { LLMMessage, LLMToolCall } from '../../services/llm/llm.types.js'
import { toLLMTool } from '../../services/llm/typebox-to-json-schema.js'
import { getProfessionalById } from '../professionals/professionals.service.js'
import type { AvailabilityExecutorContext } from './ailum-ai-availability.executor.js'
import { executeAvailabilityTool } from './ailum-ai-availability.executor.js'

const MAX_TOOL_ITERATIONS = 5
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

export interface AilumAIAvailabilityAgentResult {
  reply: string
  toolCalls: Array<{ name: string; input: Record<string, unknown>; success: boolean; message: string }>
  /** Quando uma ação requer confirmação (cancelar/remarcar), o front pode exibir botão "Confirmar" */
  requiresConfirmation?: boolean
  confirmationToken?: string
  confirmationSummary?: string
  confirmationActionType?: 'cancel' | 'reschedule'
}

export interface AilumAIChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function runAilumAIAvailabilityAgent(
  message: string,
  context: AvailabilityExecutorContext,
  fastify: { db: PrismaClient; log: { error: (o: unknown, msg?: string) => void } },
  options?: { messages?: AilumAIChatMessage[] },
): Promise<AilumAIAvailabilityAgentResult> {
  const { tenantId, professionalId } = context

  const professional = await getProfessionalById(fastify.db, tenantId, professionalId)
  if (!professional) {
    throw new Error('Profissional não encontrado')
  }

  const todayIso = getTodayIsoBR()
  const tomorrowIso = getTomorrowIsoBR()

  const contextText = buildAvailabilityContext(professional)
  const systemBlocks: TextBlockParam[] = [
    {
      type: 'text',
      text: `Você é o assistente do Dr(a). ${professional.fullName}.

SUAS FUNÇÕES:
- Disponibilidade: alterar grade semanal, bloquear dias, exceções, etc.
- Consultas: listar, cancelar e remarcar (cancelar e remarcar exigem confirmação do usuário).

REGRAS:
- Datas em formato YYYY-MM-DD (ex: ${todayIso})
- dayOfWeek: 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado
- Horários em HH:mm, incrementos de 5 min (ex: 09:00, 14:30)
- Hoje: ${todayIso}. Amanhã: ${tomorrowIso}
- Ao interpretar "amanhã", "próxima segunda", "dia 15", etc., converta para a data correta
- Confirme brevemente o que foi feito após cada alteração
- Para cancelar ou remarcar: SEMPRE use o appointmentId retornado por list_appointments (campo id em appointmentsWithIds). NUNCA invente ou deduza o id — chame list_appointments primeiro se não tiver.
- Se o usuário pedir algo ambíguo, pergunte para esclarecer`,
    },
    {
      type: 'text',
      text: `DISPONIBILIDADE ATUAL DO PROFISSIONAL:\n${contextText}`,
    },
  ]

  const llmTools = Object.values(AILUM_AI_AVAILABILITY_TOOLS).map((def) => toLLMTool(def))
  const systemText = systemBlocks.map((b) => (b as { text: string }).text).join('\n\n')

  const toolCalls: AilumAIAvailabilityAgentResult['toolCalls'] = []
  const history: LLMMessage[] = (options?.messages ?? []).map((m) =>
    m.role === 'user' ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: m.content },
  )
  let currentMessages: LLMMessage[] = [...history, { role: 'user', content: message }]
  let finalReply = ''

  const llm = getLLM()

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await llm.chatWithTools(
      [{ role: 'system', content: systemText }, ...currentMessages],
      llmTools,
      {
        model: resolveModel('sonnet'),
        maxTokens: 1024,
        temperature: 0.2,
        toolChoice: llmTools.length ? 'auto' : undefined,
      },
    )

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

    let earlyConfirm: { token: string; summary: string; actionType: 'cancel' | 'reschedule' } | null = null

    for (const tc of result.toolCalls as LLMToolCall[]) {
      const execResult = await executeAvailabilityTool(
        tc.name,
        tc.input,
        context,
        fastify as Parameters<typeof executeAvailabilityTool>[3],
      )

      toolCalls.push({
        name: tc.name,
        input: tc.input,
        success: execResult.success,
        message: execResult.message,
      })

      if (execResult.requiresConfirmation && execResult.data?.confirmationToken) {
        earlyConfirm = {
          token: execResult.data.confirmationToken as string,
          summary: (execResult.data.summary as string) ?? 'Confirme a ação',
          actionType: (execResult.data.actionType as 'cancel' | 'reschedule') ?? 'cancel',
        }
      }

      toolResultContents.push({
        toolCallId: tc.id,
        name: tc.name,
        content: JSON.stringify({
          success: execResult.success,
          message: execResult.message,
          requiresConfirmation: execResult.requiresConfirmation,
          ...execResult.data,
        }),
      })
    }

    if (earlyConfirm) {
      return {
        reply: finalReply || 'Por favor, confirme a ação para continuar.',
        toolCalls,
        requiresConfirmation: true,
        confirmationToken: earlyConfirm.token,
        confirmationSummary: earlyConfirm.summary,
        confirmationActionType: earlyConfirm.actionType,
      }
    }

    currentMessages = [
      ...currentMessages,
      { role: 'user', content: '', toolResults: toolResultContents },
    ]
  }

  return { reply: finalReply, toolCalls }
}

function buildAvailabilityContext(professional: Awaited<ReturnType<typeof getProfessionalById>>): string {
  if (!professional) return 'Sem dados.'

  const lines: string[] = []

  // Grade semanal
  if (professional.availability?.length) {
    const slots = professional.availability
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map(
        (s) =>
          `${DAY_NAMES[s.dayOfWeek]} ${s.startTime}-${s.endTime} (slot ${s.slotDurationMin}min)`,
      )
    lines.push(`Grade semanal: ${slots.join(' | ')}`)
  } else {
    lines.push('Grade semanal: (vazia)')
  }

  // Exceções (bloqueios de dia inteiro ou parcial)
  if (professional.availabilityExceptions?.length) {
    const excs = professional.availabilityExceptions.map((e) => {
      const d = e.date instanceof Date ? e.date : new Date(e.date)
      const iso = d.toISOString().slice(0, 10)
      if (e.isUnavailable) return `${iso} bloqueado${e.reason ? `: ${e.reason}` : ''}`
      const mask = Array.isArray(e.slotMask) ? e.slotMask : []
      const maskStr = mask
        .filter((m): m is { startTime: string; endTime: string } =>
          m !== null && typeof m === 'object' && 'startTime' in m && 'endTime' in m)
        .map((m) => `${m.startTime}-${m.endTime}`)
        .join(', ')
      return `${iso} parcial (removido: ${maskStr})`
    })
    lines.push(`Exceções: ${excs.join(' | ')}`)
  }

  // Overrides (dias específicos com horário)
  if (professional.availabilityOverrides?.length) {
    const ovs = professional.availabilityOverrides.map((o) => {
      const d = o.date instanceof Date ? o.date : new Date(o.date)
      return `${d.toISOString().slice(0, 10)} ${o.startTime}-${o.endTime}`
    })
    lines.push(`Overrides: ${ovs.join(' | ')}`)
  }

  // Block ranges (bloqueios de intervalo)
  if (professional.availabilityBlockRanges?.length) {
    const blks = professional.availabilityBlockRanges.map((b) => {
      const from = b.dateFrom instanceof Date ? b.dateFrom : new Date(b.dateFrom)
      const to = b.dateTo instanceof Date ? b.dateTo : new Date(b.dateTo)
      return `${from.toISOString().slice(0, 10)} a ${to.toISOString().slice(0, 10)}${b.reason ? ` (${b.reason})` : ''}`
    })
    lines.push(`Bloqueios de intervalo: ${blks.join(' | ')}`)
  }

  return lines.join('\n') || 'Nenhuma configuração adicional.'
}

const TZ_BR = 'America/Sao_Paulo'

function getTodayIsoBR(): string {
  return new Date().toLocaleString('en-CA', { timeZone: TZ_BR }).slice(0, 10)
}

function getTomorrowIsoBR(): string {
  const todayStr = getTodayIsoBR()
  const [y, m, d] = todayStr.split('-').map(Number)
  // Meio-dia para evitar edge cases de timezone em getDate()
  const tomorrow = new Date(y, m - 1, d + 1, 12, 0, 0)
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
}
