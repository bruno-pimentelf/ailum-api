import type { PrismaClient } from '../generated/prisma/client.js'
import type { Redis } from 'ioredis'
import type { FirebaseDecorator } from '../plugins/firebase.js'
import type { Storage } from 'firebase-admin/storage'
import type { MemberRole } from '../generated/prisma/client.js'
import type { Permission } from '../constants/permissions.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient
    redis: Redis
    firebase: FirebaseDecorator
    auth: { api: { createInvitation: (opts: { body: { email: string; role: string; organizationId?: string }; headers: HeadersInit }) => Promise<{ id: string } | null | undefined> } }

    /**
     * Extracts the Better Auth session from the request and decorates
     * req with userId, tenantId, role, memberId, professionalId.
     * Throws 401 if unauthenticated or 403 if not a member of a tenant.
     */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>

    /**
     * Factory that returns a hook checking whether req.role has the given permission.
     * Must be used after authenticate.
     */
    authorize: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>

    /**
     * Hook for professional write: allows ADMIN (any) or PROFESSIONAL (own only).
     * getProfessionalId(req) should return the professional id from params.
     */
    authorizeProfessionalWrite: (
      getProfessionalId: (req: FastifyRequest) => string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }

  interface FastifyRequest {
    userId: string
    tenantId: string
    role: MemberRole
    memberId: string
    professionalId: string | null
    member: {
      id: string
      userId: string
      tenantId: string
      role: MemberRole
      professionalId: string | null
      isActive: boolean
    }
  }
}
