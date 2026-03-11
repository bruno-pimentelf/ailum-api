import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, TextBlockParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js'
import { env } from '../../config/env.js'
import { AILUM_AI_AVAILABILITY_TOOLS } from '../../constants/ailum-ai-availability-tools.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { getProfessionalById } from '../professionals/professionals.service.js'
import type { AvailabilityExecutorContext } from './ailum-ai-availability.executor.js'
import { executeAvailabilityTool } from './ailum-ai-availability.executor.js'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const MAX_TOOL_ITERATIONS = 5
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

export interface AilumAIAvailabilityAgentResult {
  reply: string
  toolCalls: Array<{ name: string; input: Record<string, unknown>; success: boolean; message: string }>
}

export async function runAilumAIAvailabilityAgent(
  message: string,
  context: AvailabilityExecutorContext,
  fastify: { db: PrismaClient; log: { error: (o: unknown, msg?: string) => void } },
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
      text: `Você é o assistente de disponibilidade do Dr(a). ${professional.fullName}.

SUA FUNÇÃO: Interpretar mensagens em linguagem natural e executar alterações na disponibilidade usando as ferramentas disponíveis.

REGRAS:
- Datas em formato YYYY-MM-DD (ex: ${todayIso})
- dayOfWeek: 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado
- Horários em HH:mm, incrementos de 5 min (ex: 09:00, 14:30)
- Hoje: ${todayIso}. Amanhã: ${tomorrowIso}
- Ao interpretar "amanhã", "próxima segunda", "dia 15", etc., converta para a data correta
- Confirme brevemente o que foi feito após cada alteração
- Se o usuário pedir algo ambíguo, pergunte para esclarecer`,
    },
    {
      type: 'text',
      text: `DISPONIBILIDADE ATUAL DO PROFISSIONAL:\n${contextText}`,
    },
  ]

  const tools: Anthropic.Tool[] = Object.values(AILUM_AI_AVAILABILITY_TOOLS).map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: def.input_schema as Anthropic.Tool['input_schema'],
  }))

  const toolCalls: AilumAIAvailabilityAgentResult['toolCalls'] = []
  let currentMessages: MessageParam[] = [{ role: 'user', content: message }]
  let finalReply = ''

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      temperature: 0.2,
      system: systemBlocks as Anthropic.TextBlockParam[],
      tools,
      tool_choice: tools.length ? { type: 'auto' as const } : undefined,
      messages: currentMessages,
    })

    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    if (textContent) finalReply = textContent

    if (response.stop_reason !== 'tool_use') break

    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUseBlocks.length === 0) break

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content } as MessageParam,
    ]

    const toolResultContents: Anthropic.ToolResultBlockParam[] = []

    for (const toolBlock of toolUseBlocks) {
      const toolInput = toolBlock.input as Record<string, unknown>
      const result = await executeAvailabilityTool(
        toolBlock.name,
        toolInput,
        context,
        fastify as Parameters<typeof executeAvailabilityTool>[3],
      )

      toolCalls.push({
        name: toolBlock.name,
        input: toolInput,
        success: result.success,
        message: result.message,
      })

      toolResultContents.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify({ success: result.success, message: result.message, ...result.data }),
      })
    }

    currentMessages = [
      ...currentMessages,
      { role: 'user', content: toolResultContents } as MessageParam,
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
