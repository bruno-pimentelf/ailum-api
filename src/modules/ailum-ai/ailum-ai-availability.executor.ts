import type { FastifyInstance } from 'fastify'
import {
  setProfessionalAvailability,
  addAvailabilityException,
  removeAvailabilityException,
  addAvailabilityOverride,
  listAvailabilityOverrides,
  removeAvailabilityOverride,
  addAvailabilityBlockRange,
  listAvailabilityBlockRanges,
  removeAvailabilityBlockRange,
} from '../professionals/professionals.service.js'
import type { AilumAIAvailabilityToolName } from '../../constants/ailum-ai-availability-tools.js'

export interface AvailabilityExecutorContext {
  tenantId: string
  professionalId: string
}

export interface ExecutorResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

export async function executeAvailabilityTool(
  toolName: string,
  input: Record<string, unknown>,
  context: AvailabilityExecutorContext,
  fastify: FastifyInstance,
): Promise<ExecutorResult> {
  const { tenantId, professionalId } = context
  const db = fastify.db

  try {
    switch (toolName as AilumAIAvailabilityToolName) {
      case 'set_weekly_availability': {
        const slots = input.slots as Array<{
          dayOfWeek: number
          startTime: string
          endTime: string
          slotDurationMin?: number
        }>
        if (!Array.isArray(slots) || slots.length === 0) {
          return { success: false, message: 'Envie ao menos um bloco de horário.' }
        }
        await setProfessionalAvailability(db, tenantId, professionalId, slots)
        const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
        const summary = slots
          .map((s) => `${dayNames[s.dayOfWeek]} ${s.startTime}-${s.endTime}`)
          .join(', ')
        return { success: true, message: `Grade semanal atualizada: ${summary}` }
      }

      case 'block_day': {
        const date = input.date as string
        const reason = (input.reason as string) || undefined
        await addAvailabilityException(db, tenantId, professionalId, {
          date,
          isUnavailable: true,
          reason,
        })
        const fmt = formatDateBR(date)
        return { success: true, message: `Dia ${fmt} bloqueado.` }
      }

      case 'block_date_range': {
        const dateFrom = input.dateFrom as string
        const dateTo = input.dateTo as string
        const reason = (input.reason as string) || undefined
        if (dateTo < dateFrom) {
          return { success: false, message: 'dateTo deve ser maior ou igual a dateFrom.' }
        }
        await addAvailabilityBlockRange(db, tenantId, professionalId, {
          dateFrom,
          dateTo,
          reason,
        })
        return { success: true, message: `Período de ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} bloqueado.` }
      }

      case 'add_specific_day': {
        const date = input.date as string
        const startTime = input.startTime as string
        const endTime = input.endTime as string
        const slotDurationMin = (input.slotDurationMin as number) || undefined
        await addAvailabilityOverride(db, tenantId, professionalId, {
          date,
          startTime,
          endTime,
          slotDurationMin,
        })
        return { success: true, message: `Adicionado horário em ${formatDateBR(date)} das ${startTime} às ${endTime}.` }
      }

      case 'block_partial_day': {
        const date = input.date as string
        const slotMask = input.slotMask as Array<{ startTime: string; endTime: string }>
        if (!Array.isArray(slotMask) || slotMask.length === 0) {
          return { success: false, message: 'slotMask deve ter ao menos uma janela.' }
        }
        await addAvailabilityException(db, tenantId, professionalId, {
          date,
          isUnavailable: false,
          slotMask,
        })
        const maskStr = slotMask.map((m) => `${m.startTime}-${m.endTime}`).join(', ')
        return { success: true, message: `Bloqueio parcial em ${formatDateBR(date)}: ${maskStr} removidos.` }
      }

      case 'remove_exception': {
        const date = input.date as string
        await removeAvailabilityException(db, tenantId, professionalId, date)
        return { success: true, message: `Bloqueio de ${formatDateBR(date)} removido.` }
      }

      case 'remove_block_range': {
        const dateFrom = input.dateFrom as string
        const dateTo = input.dateTo as string
        const ranges = await listAvailabilityBlockRanges(db, tenantId, professionalId)
        const match = ranges.find(
          (r) =>
            toIsoDate(r.dateFrom) === dateFrom && toIsoDate(r.dateTo) === dateTo,
        )
        if (!match) {
          return { success: false, message: `Nenhum bloco encontrado de ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)}.` }
        }
        await removeAvailabilityBlockRange(db, tenantId, professionalId, match.id)
        return { success: true, message: `Bloqueio de ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} removido.` }
      }

      case 'remove_override': {
        const date = input.date as string
        const overrides = await listAvailabilityOverrides(db, tenantId, professionalId, {
          from: date,
          to: date,
        })
        const match = overrides.find((o) => toIsoDate(o.date) === date)
        if (!match) {
          return { success: false, message: `Nenhum override encontrado para ${formatDateBR(date)}.` }
        }
        await removeAvailabilityOverride(db, tenantId, professionalId, match.id)
        return { success: true, message: `Override de ${formatDateBR(date)} removido.` }
      }

      default:
        return { success: false, message: `Tool desconhecida: ${toolName}` }
    }
  } catch (err) {
    fastify.log.error({ err, toolName, input }, 'ailum-ai:availability:executor:error')
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Erro ao executar.',
    }
  }
}

function toIsoDate(d: Date): string {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
