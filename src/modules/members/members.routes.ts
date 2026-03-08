import type { FastifyInstance } from 'fastify'
import { MemberParamsSchema, InviteMemberSchema, UpdateMemberSchema } from './members.schema.js'
import { listMembers, inviteMember, updateMemberRole, removeMember } from './members.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function membersRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_READ)],
  }, async (req) => listMembers(fastify.db, req.tenantId))

  fastify.post('/invite', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.MEMBERS_WRITE)],
    schema: { body: InviteMemberSchema },
  }, async (req, reply) => {
    const result = await inviteMember(fastify.db, fastify, req.tenantId, req.userId, req.body as never)
    req.log.info({ memberId: result.id }, 'member:invited')
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
