import type { FastifyInstance } from 'fastify'
import { MemberParamsSchema, InviteMemberSchema, UpdateMemberSchema } from './members.schema.js'
import { listMembers, listInvitations, inviteMember, updateMemberRole, removeMember } from './members.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function membersRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_READ)],
  }, async (req) => listMembers(fastify.db, req.tenantId))

  fastify.get('/invitations', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_READ)],
  }, async (req) => listInvitations(fastify.db, req.tenantId))

  fastify.post('/invite', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_WRITE)],
    schema: { body: InviteMemberSchema },
  }, async (req, reply) => {
    const headers: HeadersInit = Object.fromEntries(
      Object.entries(req.headers)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
    )
    const result = await inviteMember(fastify.db, fastify, req.tenantId, req.body as never, headers)
    req.log.info({ invitationId: result.id }, 'member:invited')
    return reply.status(201).send(result)
  })

  fastify.patch('/:id/role', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_WRITE)],
    schema: { params: MemberParamsSchema, body: UpdateMemberSchema },
  }, async (req) => updateMemberRole(fastify.db, fastify, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_WRITE)],
    schema: { params: MemberParamsSchema },
  }, async (req) => removeMember(fastify.db, req.tenantId, (req.params as { id: string }).id))
}
