import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { agentQueue } from '../../jobs/queues.js'
import { confirmAndExecute } from './orchestrator.js'

const SendMessageSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
  message: Type.String({ minLength: 1, maxLength: 4096 }),
  sessionId: Type.Optional(Type.String()),
  testMode: Type.Optional(Type.Boolean()),
})

const ConfirmSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
})

const JobParamsSchema = Type.Object({
  jobId: Type.String(),
})

const PLAYGROUND_PHONE = '__playground__'

async function getOrCreatePlaygroundContact(
  fastify: FastifyInstance,
  tenantId: string,
) {
  const existing = await fastify.db.contact.findFirst({
    where: { tenantId, phone: PLAYGROUND_PHONE, isActive: true },
    select: { id: true, phone: true, name: true, currentStageId: true, currentFunnelId: true },
  })
  if (existing) return existing

  const firstStage = await fastify.db.stage.findFirst({
    where: { funnel: { tenantId, isActive: true } },
    orderBy: [{ funnel: { order: 'asc' } }, { order: 'asc' }],
    include: { funnel: { select: { id: true } } },
  })

  if (!firstStage) {
    throw fastify.httpErrors.badRequest(
      'Crie um funil com pelo menos um stage antes de usar o playground',
    )
  }

  const contact = await fastify.db.contact.create({
    data: {
      tenantId,
      phone: PLAYGROUND_PHONE,
      name: 'Playground',
      status: 'NEW_LEAD',
      currentFunnelId: firstStage.funnelId,
      currentStageId: firstStage.id,
      stageEnteredAt: new Date(),
    },
    select: { id: true, phone: true, name: true, currentStageId: true, currentFunnelId: true },
  })

  return contact
}

export async function agentRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/agent/playground-contact
   * Retorna ou cria o contato de playground do tenant.
   */
  fastify.get(
    '/playground-contact',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      return getOrCreatePlaygroundContact(fastify, request.tenantId)
    },
  )

  /**
   * POST /v1/agent/playground-reset
   * Apaga mensagens e memórias do contato de playground. Útil para "zerar" o contexto e testar de novo.
   * Também remove mensagens do Firestore para o chat sumir no frontend.
   */
  fastify.post(
    '/playground-reset',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const contact = await getOrCreatePlaygroundContact(fastify, request.tenantId)
      const messageIds = await fastify.db.message.findMany({
        where: { contactId: contact.id, tenantId: request.tenantId },
        select: { id: true },
      })

      if (fastify.firebase.firestore && messageIds.length > 0) {
        const BATCH_LIMIT = 500
        for (let i = 0; i < messageIds.length; i += BATCH_LIMIT) {
          const chunk = messageIds.slice(i, i + BATCH_LIMIT)
          const batch = fastify.firebase.firestore.batch()
          const col = fastify.firebase.firestore
            .collection('tenants')
            .doc(request.tenantId)
            .collection('contacts')
            .doc(contact.id)
            .collection('messages')
          for (const m of chunk) {
            batch.delete(col.doc(m.id))
          }
          await batch.commit()
        }
      }

      const [deletedMessages, deletedMemories] = await Promise.all([
        fastify.db.message.deleteMany({
          where: { contactId: contact.id, tenantId: request.tenantId },
        }),
        fastify.db.agentMemory.deleteMany({
          where: { contactId: contact.id, tenantId: request.tenantId },
        }),
      ])
      fastify.log.info(
        { contactId: contact.id, messages: deletedMessages.count, memories: deletedMemories.count },
        'agent:playground:reset',
      )
      return reply.status(204).send()
    },
  )

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
      const { contactId, message, sessionId, testMode } = request.body as {
        contactId: string
        message: string
        sessionId?: string
        testMode?: boolean
      }

      // testMode (playground): salva mensagem do usuário antes de enfileirar
      if (testMode) {
        const sync = new (await import('../../services/firebase-sync.service.js')).FirebaseSyncService(
          fastify.firebase.firestore,
          fastify.log,
        )
        const saved = await fastify.db.message.create({
          data: {
            tenantId: request.tenantId,
            contactId,
            role: 'CONTACT',
            type: 'TEXT',
            content: message,
          },
        })
        await sync.syncConversationMessage(request.tenantId, contactId, {
          id: saved.id,
          role: 'CONTACT',
          type: 'TEXT',
          content: message,
          createdAt: saved.createdAt,
        })
      }

      const job = await agentQueue.add(
        'process-message',
        {
          tenantId: request.tenantId,
          contactId,
          messageContent: message,
          messageType: 'TEXT',
          sessionId,
          testMode: testMode ?? false,
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
   * GET /v1/agent/audit
   * Lista os últimos audit logs do agente para um contato (ex.: playground).
   * Query: contactId (uuid), limit (opcional, default 20)
   */
  fastify.get(
    '/audit',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { contactId, limit } = request.query as {
        contactId?: string
        limit?: number
      }
      if (!contactId) return reply.badRequest('contactId é obrigatório')

      const logs = await fastify.db.agentJobLog.findMany({
        where: { contactId, tenantId: request.tenantId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit ?? 20, 50),
        select: {
          id: true,
          status: true,
          routerIntent: true,
          routerConfidence: true,
          stageAgentToolCalls: true,
          totalInputTokens: true,
          totalOutputTokens: true,
          durationMs: true,
          error: true,
          auditDetails: true,
          createdAt: true,
        },
      })
      return logs
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
