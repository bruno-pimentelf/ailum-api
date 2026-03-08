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

      try {
        // First, save the incoming contact message to DB
        const savedMessage = await fastify.db.message.create({
          data: {
            tenantId,
            contactId,
            role: 'CONTACT',
            type: (job.data.messageType as 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT') ?? 'TEXT',
            content: messageContent,
            zapiMessageId: job.data.zapiMessageId,
            sessionId: job.data.sessionId,
          },
        })

        // Sync contact message to Firestore
        await fastify.firebase.firestore
          .collection('tenants')
          .doc(tenantId)
          .collection('contacts')
          .doc(contactId)
          .collection('messages')
          .doc(savedMessage.id)
          .set({
            id: savedMessage.id,
            role: 'CONTACT',
            type: savedMessage.type,
            content: savedMessage.content,
            createdAt: savedMessage.createdAt,
          })

        // Run the full orchestration pipeline
        const result = await orchestrate(messageContent, contactId, tenantId, fastify)

        job.log(`[agent-job] status=${result.status} duration=${result.durationMs}ms`)

        return result
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        // Log error to agent_job_logs
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

        // Ensure typing indicator is turned off even on failure
        try {
          await fastify.firebase.firestore
            .collection('tenants')
            .doc(tenantId)
            .collection('contacts')
            .doc(contactId)
            .set({ agentTyping: false, updatedAt: new Date() }, { merge: true })
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
