import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { runAilumAIAvailabilityAgent } from './ailum-ai-availability.agent.js'
import { ailumAiConfirmAndExecute } from './ailum-ai-confirm.js'

const ChatMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  content: Type.String(),
})

const AilumAIAvailabilityBodySchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  professionalId: Type.Optional(Type.String({ format: 'uuid' })),
  messages: Type.Optional(Type.Array(ChatMessageSchema)),
})

export async function ailumAiRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: { message: string; professionalId?: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> }
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
          requiresConfirmation: Type.Optional(Type.Boolean()),
          confirmationToken: Type.Optional(Type.String()),
          confirmationSummary: Type.Optional(Type.String()),
          confirmationActionType: Type.Optional(Type.Union([Type.Literal('cancel'), Type.Literal('reschedule')])),
        }),
      },
    },
  }, async (req, reply) => {
    const professionalId = req.body.professionalId ?? req.professionalId!
    const result = await runAilumAIAvailabilityAgent(
      req.body.message,
      { tenantId: req.tenantId, professionalId },
      fastify,
      { messages: req.body.messages },
    )

    return {
      reply: result.reply,
      toolCalls: result.toolCalls,
      ...(result.requiresConfirmation && {
        requiresConfirmation: true,
        confirmationToken: result.confirmationToken,
        confirmationSummary: result.confirmationSummary,
        confirmationActionType: result.confirmationActionType,
      }),
    }
  })

  fastify.post<{
    Body: { confirmationToken: string; professionalId?: string }
  }>('/confirm', {
    onRequest: [fastify.authenticate],
    preValidation: [
      async (req, reply) => {
        const body = req.body as { confirmationToken?: string; professionalId?: string } | undefined
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
      body: Type.Object({
        confirmationToken: Type.String({ format: 'uuid' }),
        professionalId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
      response: {
        200: Type.Object({
          success: Type.Boolean(),
          message: Type.String(),
        }),
      },
    },
  }, async (req, reply) => {
    const professionalId = req.body.professionalId ?? req.professionalId!
    const result = await ailumAiConfirmAndExecute(
      req.body.confirmationToken,
      { tenantId: req.tenantId, professionalId },
      fastify,
    )
    return result
  })
}
