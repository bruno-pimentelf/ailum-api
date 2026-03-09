import type { FastifyInstance } from 'fastify'
import { getAuth } from 'firebase-admin/auth'

export async function authRoutes(fastify: FastifyInstance) {
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
