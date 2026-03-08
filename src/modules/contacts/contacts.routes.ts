import type { FastifyInstance } from 'fastify'
import {
  ContactParamsSchema,
  CreateContactSchema,
  ListContactsQuerySchema,
  MoveStageSchema,
  UpdateContactSchema,
} from './contacts.schema.js'
import {
  createContact,
  getContactById,
  listContacts,
  moveContactStage,
  softDeleteContact,
  updateContact,
} from './contacts.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function contactsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_READ)],
      schema: { querystring: ListContactsQuerySchema },
    },
    async (req) => listContacts(fastify.db, req.tenantId, req.query as never),
  )

  fastify.get(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_READ)],
      schema: { params: ContactParamsSchema },
    },
    async (req, reply) => {
      const contact = await getContactById(fastify.db, req.tenantId, (req.params as { id: string }).id)
      if (!contact) return reply.notFound('Contact not found')
      return contact
    },
  )

  fastify.post(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_WRITE)],
      schema: { body: CreateContactSchema },
    },
    async (req, reply) => {
      const body = req.body as never
      try {
        const contact = await createContact(fastify.db, req.tenantId, body)
        req.log.info({ contactId: contact.id }, 'contact:created')
        return reply.status(201).send(contact)
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'P2002') {
          return reply.badRequest('A contact with this phone already exists')
        }
        throw err
      }
    },
  )

  fastify.patch(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_WRITE)],
      schema: { params: ContactParamsSchema, body: UpdateContactSchema },
    },
    async (req) => updateContact(fastify.db, fastify, req.tenantId, (req.params as { id: string }).id, req.body as never),
  )

  fastify.patch(
    '/:id/stage',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_WRITE)],
      schema: { params: ContactParamsSchema, body: MoveStageSchema },
    },
    async (req) => {
      const { id } = req.params as { id: string }
      const { stageId } = req.body as { stageId: string }
      return moveContactStage(fastify.db, fastify, req.tenantId, id, stageId)
    },
  )

  fastify.delete(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.CONTACTS_DELETE)],
      schema: { params: ContactParamsSchema },
    },
    async (req) => softDeleteContact(fastify.db, req.tenantId, (req.params as { id: string }).id),
  )
}
