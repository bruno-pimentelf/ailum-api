import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { runAilumAIAvailabilityAgent } from './ailum-ai-availability.agent.js'

const AilumAIAvailabilityBodySchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  professionalId: Type.Optional(Type.String({ format: 'uuid' })),
})

export async function ailumAiRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: { message: string; professionalId?: string }
  }>('/availability', {
    onRequest: [fastify.authenticate],
    preValidation: [
      async (req, reply) => {
        const body = req.body as { message?: string; professionalId?: string } | undefined
        const professionalId = body?.professionalId ?? req.professionalId
        if (!professionalId) {
          return reply.status(400).send({
            error: 'professionalId obrigatório',
            message: 'Envie professionalId no body (ADMIN) ou faça login como profissional.',
          })
        }
        await fastify.authorizeProfessionalWrite(() => professionalId)(req, reply)
      },
    ],
    schema: {
      body: AilumAIAvailabilityBodySchema,
      response: {
        200: Type.Object({
          reply: Type.String(),
          toolCalls: Type.Array(
            Type.Object({
              name: Type.String(),
              input: Type.Record(Type.String(), Type.Unknown()),
              success: Type.Boolean(),
              message: Type.String(),
            }),
          ),
        }),
      },
    },
  }, async (req, reply) => {
    const professionalId = req.body.professionalId ?? req.professionalId!
    const result = await runAilumAIAvailabilityAgent(
      req.body.message,
      { tenantId: req.tenantId, professionalId },
      fastify,
    )

    return { reply: result.reply, toolCalls: result.toolCalls }
  })
}
