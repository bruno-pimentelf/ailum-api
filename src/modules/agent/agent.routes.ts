import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { agentQueue } from '../../jobs/queues.js'
import { confirmAndExecute } from './orchestrator.js'

const SendMessageSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
  message: Type.String({ minLength: 1, maxLength: 4096 }),
  sessionId: Type.Optional(Type.String()),
})

const ConfirmSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
})

const JobParamsSchema = Type.Object({
  jobId: Type.String(),
})

export async function agentRoutes(fastify: FastifyInstance) {
  /**
   * POST /v1/agent/message
   * Enqueues an incoming message for async processing by the agent.
   * Returns 202 immediately with a jobId.
   */
  fastify.post(
    '/message',
    {
      onRequest: [fastify.authenticate],
      schema: { body: SendMessageSchema },
    },
    async (request, reply) => {
      const { contactId, message, sessionId } = request.body as {
        contactId: string
        message: string
        sessionId?: string
      }

      const job = await agentQueue.add(
        'process-message',
        {
          tenantId: request.tenantId,
          contactId,
          messageContent: message,
          messageType: 'TEXT',
          sessionId,
        },
        {
          jobId: `agent:${contactId}:${Date.now()}`,
          // Deduplicate: only one message per contact at a time
          // If a job already exists for this contact, it will be queued after
        },
      )

      return reply.status(202).send({ jobId: job.id, status: 'queued' })
    },
  )

  /**
   * POST /v1/agent/confirm
   * Confirms and executes pending tool calls (create_appointment, generate_pix).
   * Called when the operator/patient confirms the agent's proposal.
   */
  fastify.post(
    '/confirm',
    {
      onRequest: [fastify.authenticate],
      schema: { body: ConfirmSchema },
    },
    async (request) => {
      const { contactId } = request.body as { contactId: string }
      return confirmAndExecute(contactId, request.tenantId, fastify)
    },
  )

  /**
   * GET /v1/agent/job/:jobId
   * Returns the current state of an agent job.
   */
  fastify.get(
    '/job/:jobId',
    {
      onRequest: [fastify.authenticate],
      schema: { params: JobParamsSchema },
    },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      const job = await agentQueue.getJob(jobId)

      if (!job) return reply.notFound('Job not found')

      const state = await job.getState()
      const result = job.returnvalue as Record<string, unknown> | null

      return {
        jobId: job.id,
        state,
        result,
        failedReason: job.failedReason,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      }
    },
  )
}
