import type { FastifyInstance } from 'fastify'
import { getAuth } from 'firebase-admin/auth'

export async function authRoutes(fastify: FastifyInstance) {
  // GET /v1/auth/me
  // Retorna os dados do usuário autenticado + contexto do tenant (role, memberId, etc.)
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
  }, async (req) => {
    const user = await fastify.db.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, image: true, createdAt: true },
    })

    const tenant = await fastify.db.tenant.findUnique({
      where: { id: req.tenantId },
      select: { id: true, name: true, slug: true },
    })

    return {
      id: req.userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
      image: user?.image ?? null,
      createdAt: user?.createdAt ?? null,
      memberId: req.memberId,
      role: req.role,
      professionalId: req.professionalId,
      tenant,
    }
  })

  // GET /v1/auth/firebase-token
  // Gera um Firebase custom token para o usuário autenticado via better-auth.
  // O frontend usa o token para fazer signInWithCustomToken e habilitar onSnapshot
  // com as Firestore Security Rules ativas (request.auth != null).
  //
  // Também retorna o tenantId do Postgres — necessário porque o better-auth expõe
  // apenas o organizationId (ID alfanumérico), mas o Firestore usa o UUID interno
  // do tenant como chave dos documentos. O front deve armazenar esse tenantId e
  // usá-lo em todos os paths do Firestore: tenants/{tenantId}/contacts/...
  fastify.get('/firebase-token', {
    onRequest: [fastify.authenticate],
  }, async (req, reply) => {
    if (!fastify.firebase.admin) {
      return reply.status(503).send({ error: 'Firebase not configured' })
    }

    const token = await getAuth(fastify.firebase.admin).createCustomToken(req.userId, {
      tenantId: req.tenantId,
    })

    return {
      token,
      tenantId: req.tenantId,
    }
  })
}
