import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { consolidateMemories } from '../modules/agent/memory.service.js'
import type { ContextMessage } from '../types/context.js'

export interface MemoryConsolidationJobData {
  tenantId: string
  contactId: string
  sessionMessageIds: string[]
}

export function createMemoryConsolidationWorker(fastify: FastifyInstance) {
  const worker = new Worker<MemoryConsolidationJobData>(
    'memory-consolidation',
    async (job) => {
      const { contactId, tenantId, sessionMessageIds } = job.data

      job.log(`Consolidating memories for contact ${contactId} (${sessionMessageIds.length} messages)`)

      // Fetch the session messages
      const messages = await fastify.db.message.findMany({
        where: {
          id: { in: sessionMessageIds },
          contactId,
          tenantId,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, type: true, createdAt: true },
      })

      if (messages.length < 2) {
        job.log('Not enough messages to consolidate')
        return
      }

      const contextMessages: ContextMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        type: m.type,
        createdAt: m.createdAt,
      }))

      await consolidateMemories(contactId, tenantId, contextMessages, fastify)

      job.log(`Memory consolidation complete`)
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5,
      // Lower priority — can run in background
      lockDuration: 120_000,
    },
  )

  worker.on('failed', (job, err) => {
    fastify.log.error(
      { jobId: job?.id, contactId: job?.data.contactId, err },
      'memory-consolidation-job:failed',
    )
  })

  worker.on('completed', (job) => {
    fastify.log.debug(
      { jobId: job.id, contactId: job.data.contactId },
      'memory-consolidation-job:completed',
    )
  })

  return worker
}
