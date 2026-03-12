import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { getEntryFunnelFirstStage } from '../modules/funnels/funnels.service.js'
import { FirebaseSyncService } from '../services/firebase-sync.service.js'
import { orchestrate } from '../modules/agent/orchestrator.js'

export interface AgentJobData {
  tenantId: string
  contactId: string
  messageContent: string
  messageType: string
  zapiMessageId?: string
  sessionId?: string
  testMode?: boolean
}

export function createAgentWorker(fastify: FastifyInstance) {
  const worker = new Worker<AgentJobData>(
    'agent',
    async (job) => {
      const { tenantId, contactId, messageContent, testMode } = job.data

      job.log(`[agent-job] contact=${contactId} tenant=${tenantId} testMode=${testMode ?? false}`)

      // Verifica se o agente está configurado (API key do provider)
      const hasApiKey =
        (env.LLM_PROVIDER === 'openai' && !!env.OPENAI_API_KEY) ||
        (env.LLM_PROVIDER === 'gemini' && !!env.GEMINI_API_KEY) ||
        ((env.LLM_PROVIDER === 'anthropic' || !env.LLM_PROVIDER) && !!env.ANTHROPIC_API_KEY)
      if (!hasApiKey) {
        fastify.log.warn({ contactId, tenantId }, 'agent-job:skipped — LLM API key not set')
        return { status: 'skipped', reason: 'agent_not_configured' }
      }

      try {
        // Se o contato não tem stage, atribui ao primeiro stage do funil de entrada (isDefault ou primeiro por order)
        const contact = await fastify.db.contact.findUnique({
          where: { id: contactId, tenantId },
          select: { currentStageId: true },
        })
        if (contact && !contact.currentStageId) {
          const entry = await getEntryFunnelFirstStage(fastify.db, tenantId)
          if (entry) {
            const updated = await fastify.db.contact.update({
              where: { id: contactId, tenantId },
              data: {
                currentStageId: entry.stageId,
                currentFunnelId: entry.funnelId,
                stageEnteredAt: new Date(),
                updatedAt: new Date(),
              },
            })
            const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
            await sync.syncContact(tenantId, {
              id: updated.id,
              phone: updated.phone,
              name: updated.name,
              email: updated.email,
              status: updated.status,
              currentStageId: updated.currentStageId,
              currentFunnelId: updated.currentFunnelId,
              lastMessageAt: updated.lastMessageAt,
              assignedProfessionalId: updated.assignedProfessionalId,
            })
            job.log(`[agent-job] contact assigned to entry stage ${entry.stageId}`)
          }
        }

        // A mensagem já foi salva pelo webhook antes de enfileirar — não salvar novamente
        const result = await orchestrate(messageContent, contactId, tenantId, fastify, {
          testMode: testMode ?? false,
        })

        job.log(`[agent-job] status=${result.status} duration=${result.durationMs}ms`)

        return result
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        try {
          await fastify.db.agentJobLog.create({
            data: {
              tenantId,
              contactId,
              status: 'ERROR',
              error: errorMessage,
              durationMs: 0,
              auditDetails: [{ label: 'Erro', detail: errorMessage }],
            },
          })
        } catch (logErr) {
          fastify.log.error({ logErr }, 'agent-job:failed to write error log')
        }

        // Garante que o indicador de digitação seja limpo em caso de erro
        try {
          if (fastify.firebase.firestore) {
            await fastify.firebase.firestore
              .collection('tenants')
              .doc(tenantId)
              .collection('contacts')
              .doc(contactId)
              .set({ agentTyping: false, updatedAt: new Date() }, { merge: true })
          }
        } catch {
          // best effort
        }

        fastify.log.error({ err, contactId, tenantId, jobId: job.id }, 'agent-job:error')
        throw err
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5,
      // Prevent multiple jobs for same contact running simultaneously
      lockDuration: 60_000,
    },
  )

  worker.on('failed', (job, err) => {
    fastify.log.error(
      { jobId: job?.id, contactId: job?.data.contactId, err },
      'agent-job:failed',
    )
  })

  worker.on('completed', (job) => {
    fastify.log.debug({ jobId: job.id, contactId: job.data.contactId }, 'agent-job:completed')
  })

  return worker
}
