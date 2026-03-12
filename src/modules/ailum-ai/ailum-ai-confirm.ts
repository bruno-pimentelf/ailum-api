import type { FastifyInstance } from 'fastify'
import { cancelAppointment, updateAppointment } from '../scheduling/scheduling.service.js'
import { ailumAiPendingConfirmKey } from './ailum-ai-availability.executor.js'

interface ConfirmContext {
  tenantId: string
  professionalId: string
}

type PendingState =
  | { action: 'cancel'; tenantId: string; professionalId: string; appointmentId: string; summary: string }
  | {
      action: 'reschedule'
      tenantId: string
      professionalId: string
      appointmentId: string
      scheduledAt: string
      summary: string
    }

export async function ailumAiConfirmAndExecute(
  confirmationToken: string,
  context: ConfirmContext,
  fastify: FastifyInstance,
): Promise<{ success: boolean; message: string }> {
  const key = ailumAiPendingConfirmKey(confirmationToken)
  const raw = await fastify.redis.get(key)

  if (!raw) {
    return { success: false, message: 'Solicitação expirada. Por favor, tente novamente.' }
  }

  const state = JSON.parse(raw) as PendingState

  if (state.tenantId !== context.tenantId || state.professionalId !== context.professionalId) {
    return { success: false, message: 'Token inválido ou não autorizado.' }
  }

  await fastify.redis.del(key)

  try {
    if (state.action === 'cancel') {
      await cancelAppointment(fastify.db, fastify, state.tenantId, state.appointmentId)
      return { success: true, message: 'Consulta cancelada com sucesso.' }
    }

    if (state.action === 'reschedule') {
      await updateAppointment(fastify.db, fastify, state.tenantId, state.appointmentId, {
        scheduledAt: state.scheduledAt,
      })
      return { success: true, message: 'Consulta remarcada com sucesso.' }
    }

    return { success: false, message: 'Ação não suportada.' }
  } catch (err) {
    fastify.log.error({ err, state }, 'ailum-ai:confirm:error')
    return { success: false, message: err instanceof Error ? err.message : 'Erro ao executar. Tente novamente.' }
  }
}
