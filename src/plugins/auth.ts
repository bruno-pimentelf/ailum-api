import { randomUUID } from 'node:crypto'
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from '@better-auth/prisma-adapter'
import { organization } from 'better-auth/plugins'
import { env } from '../config/env.js'
import { ROLE_PERMISSIONS, type Permission } from '../constants/permissions.js'
import type { MemberRole } from '../generated/prisma/client.js'
import { sendInvitationEmail } from '../services/email.service.js'

async function authPlugin(fastify: FastifyInstance) {
  const isProd = env.NODE_ENV === 'production'

  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/auth',
    database: prismaAdapter(fastify.db, { provider: 'postgresql' }),
    emailAndPassword: { enabled: true },
    advanced: {
      disableCSRFCheck: !isProd,
      defaultCookieAttributes: isProd
        ? { sameSite: 'none', secure: true, httpOnly: true }
        : { sameSite: 'lax', secure: false, httpOnly: true },
    },
    plugins: [
      organization({
        async sendInvitationEmail(data) {
          await sendInvitationEmail({
            to: data.email,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            inviteLink: `${env.WEB_URL}/invite/${data.id}`,
          })
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, member }) => {
            try {
              // 1. Cria o tenant espelho
              const tenant = await fastify.db.tenant.upsert({
                where: { clerkOrgId: org.id },
                create: {
                  clerkOrgId: org.id,
                  name: org.name,
                  slug: org.slug ?? org.id,
                  isActive: true,
                },
                update: {
                  name: org.name,
                  slug: org.slug ?? org.id,
                },
              })
              fastify.log.info({ orgId: org.id }, 'auth:org:tenant_mirror_created')

              // 2. Cria o tenant_member espelho para o criador (owner/admin)
              if (member) {
                const roleMap: Record<string, MemberRole> = {
                  admin: 'ADMIN',
                  owner: 'ADMIN',
                  professional: 'PROFESSIONAL',
                  secretary: 'SECRETARY',
                  member: 'SECRETARY',
                }
                const role: MemberRole = roleMap[member.role] ?? 'ADMIN'

                // Better Auth usa IDs alfanuméricos, não UUIDs — usamos findFirst + create/update
                const existing = await fastify.db.tenantMember.findFirst({
                  where: { tenantId: tenant.id, userId: member.userId },
                })
                if (!existing) {
                  await fastify.db.tenantMember.create({
                    data: {
                      id: randomUUID(),
                      tenantId: tenant.id,
                      userId: member.userId,
                      role,
                      isActive: true,
                      joinedAt: new Date(),
                    },
                  })
                }
                fastify.log.info({ tenantId: tenant.id, userId: member.userId }, 'auth:member:tenant_member_mirror_created')
              }
            } catch (err) {
              fastify.log.error({ err, orgId: org.id }, 'auth:org:tenant_mirror_error')
            }
          },
        },
      }),
    ],
    trustedOrigins: [
      env.WEB_URL,
      env.APP_URL,
      'http://localhost:3001',
      'http://localhost:3000',
      'http://127.0.0.1:3001',
      ...(env.ALLOWED_ORIGINS
        ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : []),
    ],
  })

  // Mount all Better Auth routes at /auth/*
  const authHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(request.url, env.BETTER_AUTH_URL)
    const webRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers as HeadersInit,
      body:
        request.method !== 'GET' && request.method !== 'HEAD'
          ? JSON.stringify(request.body)
          : undefined,
    })

    const response = await auth.handler(webRequest)

    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })

    const text = await response.text()
    return reply.send(text)
  }

  fastify.register(async (authScope) => {
    authScope.all('/*', authHandler)
  }, { prefix: '/auth' })

  // ── authenticate decorator ─────────────────────────────────────────────────
  // Extracts session, resolves tenantId, populates request properties.
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({
      headers: request.headers as unknown as Headers,
    })

    if (!session?.user || !session?.session) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const activeOrgId = (session.session as { activeOrganizationId?: string })
      .activeOrganizationId

    if (!activeOrgId) {
      return reply.status(403).send({ error: 'No active organization selected' })
    }

    const tenant = await fastify.db.tenant.findUnique({
      where: { clerkOrgId: activeOrgId },
      select: { id: true, isActive: true },
    })

    if (!tenant || !tenant.isActive) {
      return reply.status(403).send({ error: 'Tenant not found or inactive' })
    }

    const member = await fastify.db.tenantMember.findFirst({
      where: { tenantId: tenant.id, userId: session.user.id, isActive: true },
      select: { id: true, userId: true, tenantId: true, role: true, professionalId: true, isActive: true },
    })

    if (!member) {
      return reply.status(403).send({ error: 'Not a member of this tenant' })
    }

    request.userId = session.user.id
    request.tenantId = tenant.id
    request.role = member.role as MemberRole
    request.memberId = member.id
    request.professionalId = member.professionalId
    request.member = member
  }

  // ── authorize decorator ────────────────────────────────────────────────────
  const authorize =
    (permission: Permission) => async (request: FastifyRequest, reply: FastifyReply) => {
      const allowed = ROLE_PERMISSIONS[request.role]?.includes(permission) ?? false
      if (!allowed) {
        return reply.status(403).send({ error: 'Insufficient permissions', required: permission })
      }
    }

  fastify.decorate('authenticate', authenticate)
  fastify.decorate('authorize', authorize)
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] })
