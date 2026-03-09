import type { FastifyInstance } from 'fastify'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  ContactParamsSchema,
  SendMessageSchema,
  ListMessagesQuerySchema,
} from './conversations.schema.js'
import {
  listMessages,
  sendOperatorMessage,
  markConversationRead,
} from './conversations.service.js'

export async function conversationsRoutes(fastify: FastifyInstance) {
  // GET /v1/conversations/:contactId/messages — histórico paginado de mensagens
  fastify.get('/:contactId/messages', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_READ)],
    schema: {
      params: ContactParamsSchema,
      querystring: ListMessagesQuerySchema,
    },
  }, async (req) => {
    const { contactId } = req.params as { contactId: string }
    const { limit, before } = req.query as { limit?: number; before?: string }
    return listMessages(fastify.db, req.tenantId, contactId, limit, before)
  })

  // POST /v1/conversations/:contactId/messages — operador envia mensagem ao contato
  fastify.post('/:contactId/messages', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_WRITE)],
    schema: {
      params: ContactParamsSchema,
      body: SendMessageSchema,
    },
  }, async (req, reply) => {
    const { contactId } = req.params as { contactId: string }
    const body = req.body as {
      type: string
      text?: string
      mediaUrl?: string
      caption?: string
      fileName?: string
      latitude?: string
      longitude?: string
      locationTitle?: string
      locationAddress?: string
      contactName?: string
      contactPhone?: string
      reaction?: string
      replyToZapiMessageId?: string
    }

    const result = await sendOperatorMessage(
      fastify.db,
      fastify.firebase.firestore,
      fastify.log,
      req.tenantId,
      contactId,
      req.userId,
      body as Parameters<typeof sendOperatorMessage>[6],
    )

    return reply.status(201).send(result)
  })

  // PATCH /v1/conversations/:contactId/read — marca mensagens como lidas (zera unreadCount)
  fastify.patch('/:contactId/read', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_READ)],
    schema: { params: ContactParamsSchema },
  }, async (req, reply) => {
    const { contactId } = req.params as { contactId: string }
    await markConversationRead(
      fastify.db,
      fastify.firebase.firestore,
      fastify.log,
      req.tenantId,
      contactId,
    )
    return reply.status(204).send()
  })
}
