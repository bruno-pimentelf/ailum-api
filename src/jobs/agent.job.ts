import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { orchestrate } from '../modules/agent/orchestrator.js'

export interface AgentJobData {
  tenantId: string
  contactId: string
  messageContent: string
  messageType: string
  zapiMessageId?: string
  sessionId?: string
}

export function createAgentWorker(fastify: FastifyInstance) {
  const worker = new Worker<AgentJobData>(
    'agent',
    async (job) => {
      const { tenantId, contactId, messageContent } = job.data

      job.log(`[agent-job] contact=${contactId} tenant=${tenantId}`)

      // Verifica se o agente está configurado (ANTHROPIC_API_KEY)
      if (!env.ANTHROPIC_API_KEY) {
        fastify.log.warn({ contactId, tenantId }, 'agent-job:skipped — ANTHROPIC_API_KEY not set')
        return { status: 'skipped', reason: 'agent_not_configured' }
      }

      try {
        // A mensagem já foi salva pelo webhook antes de enfileirar — não salvar novamente
        const result = await orchestrate(messageContent, contactId, tenantId, fastify)

        job.log(`[agent-job] status=${result.status} duration=${result.durationMs}ms`)

        return result
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        try {
          await fastify.db.agentJobLog.create({
            data: {
              tenantId,
              contactId,
              error: errorMessage,
              durationMs: 0,
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
