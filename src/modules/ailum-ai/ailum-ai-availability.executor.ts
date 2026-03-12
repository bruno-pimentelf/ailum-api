import { randomUUID } from 'node:crypto'
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
import {
  listAppointments,
  getAppointmentById,
  cancelAppointment,
  updateAppointment,
} from '../scheduling/scheduling.service.js'
import type { AilumAIAvailabilityToolName } from '../../constants/ailum-ai-availability-tools.js'

const AILUM_AI_CONFIRMATION_TTL_SEC = 600
const TZ_BR = 'America/Sao_Paulo'
export const ailumAiPendingConfirmKey = (token: string) => `ailum_ai_pending:${token}`

export interface AvailabilityExecutorContext {
  tenantId: string
  professionalId: string
}

export interface ExecutorResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
  /** Quando true, a ação requer confirmação do usuário antes de executar */
  requiresConfirmation?: boolean
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

      case 'list_appointments': {
        const fromInput = input.from as string | undefined
        const toInput = input.to as string | undefined
        const { data } = await listAppointments(db, tenantId, {
          professionalId,
          from: fromInput,
          to: toInput,
          status: undefined,
          page: 1,
          limit: 50,
        }, 'PROFESSIONAL', professionalId)
        const appointmentsWithIds = data.map((a) => {
          const dt = a.scheduledAt instanceof Date ? a.scheduledAt : new Date(a.scheduledAt)
          const dateTimeBr = dt.toLocaleString('pt-BR', {
            timeZone: TZ_BR,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          const contact = (a as { contact?: { name?: string } }).contact?.name ?? 'N/A'
          const service = (a as { service?: { name?: string } }).service?.name ?? 'N/A'
          return {
            id: a.id,
            dateTime: dateTimeBr,
            contact,
            service,
            summary: `${dateTimeBr} — ${contact} — ${service}`,
          }
        })
        const formatted = appointmentsWithIds.map((a) => `id=${a.id} | ${a.summary}`)
        if (formatted.length === 0) {
          const range = fromInput && toInput ? `${formatDateBR(fromInput)} a ${formatDateBR(toInput)}` : fromInput ? formatDateBR(fromInput) : 'período'
          return { success: true, message: `Nenhuma consulta no ${range}.`, data: { appointments: [], appointmentsWithIds: [] } }
        }
        return {
          success: true,
          message: `Encontradas ${formatted.length} consulta(s). Para cancelar ou remarcar, use o appointmentId exato da lista.`,
          data: { appointments: formatted, appointmentsWithIds },
        }
      }

      case 'cancel_appointment': {
        const appointmentId = input.appointmentId as string
        const appt = await getAppointmentById(db, tenantId, appointmentId)
        if (!appt || appt.professionalId !== professionalId) {
          return { success: false, message: 'Consulta não encontrada ou não pertence ao profissional.' }
        }
        if (appt.status === 'CANCELLED') {
          return { success: false, message: 'Esta consulta já está cancelada.' }
        }
        const contact = (appt as { contact?: { name?: string } }).contact?.name ?? ' paciente'
        const scheduledAt = appt.scheduledAt instanceof Date ? appt.scheduledAt : new Date(appt.scheduledAt)
        const summary = `Cancelar consulta de ${contact} em ${formatDateTimeBRTz(scheduledAt)}`
        const token = randomUUID()
        const state = {
          action: 'cancel' as const,
          tenantId,
          professionalId,
          appointmentId,
          summary,
          createdAt: Date.now(),
        }
        await fastify.redis.set(
          ailumAiPendingConfirmKey(token),
          JSON.stringify(state),
          'EX',
          AILUM_AI_CONFIRMATION_TTL_SEC,
        )
        return {
          success: true,
          message: 'Confirmação necessária para cancelar. Peça ao usuário que confirme.',
          requiresConfirmation: true,
          data: { confirmationToken: token, actionType: 'cancel', summary },
        }
      }

      case 'reschedule_appointment': {
        const appointmentId = input.appointmentId as string
        const scheduledAt = input.scheduledAt as string
        const appt = await getAppointmentById(db, tenantId, appointmentId)
        if (!appt || appt.professionalId !== professionalId) {
          return { success: false, message: 'Consulta não encontrada ou não pertence ao profissional.' }
        }
        if (appt.status === 'CANCELLED') {
          return { success: false, message: 'Não é possível remarcar uma consulta já cancelada.' }
        }
        const contact = (appt as { contact?: { name?: string } }).contact?.name ?? ' paciente'
        const oldDate = appt.scheduledAt instanceof Date ? appt.scheduledAt : new Date(appt.scheduledAt)
        const newDate = new Date(scheduledAt)
        const summary = `Remarcar consulta de ${contact} de ${formatDateTimeBRTz(oldDate)} para ${formatDateTimeBRTz(newDate)}`
        const token = randomUUID()
        const state = {
          action: 'reschedule' as const,
          tenantId,
          professionalId,
          appointmentId,
          scheduledAt,
          summary,
          createdAt: Date.now(),
        }
        await fastify.redis.set(
          ailumAiPendingConfirmKey(token),
          JSON.stringify(state),
          'EX',
          AILUM_AI_CONFIRMATION_TTL_SEC,
        )
        return {
          success: true,
          message: 'Confirmação necessária para remarcar. Peça ao usuário que confirme.',
          requiresConfirmation: true,
          data: { confirmationToken: token, actionType: 'reschedule', summary },
        }
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

/** Formata data/hora em horário de Brasília (America/Sao_Paulo) */
function formatDateTimeBRTz(d: Date): string {
  return (d instanceof Date ? d : new Date(d)).toLocaleString('pt-BR', {
    timeZone: TZ_BR,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

