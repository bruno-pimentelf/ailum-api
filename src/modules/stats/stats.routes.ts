import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  getStatsOverview,
  getStatsFunnel,
  getStatsAgenda,
  getStatsRevenue,
  getStatsAgent,
} from './stats.service.js'

const datePattern = Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }))

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: { from?: string; to?: string; professionalId?: string }
  }>('/overview', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: Type.Object({
        from: datePattern,
        to: datePattern,
        professionalId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
      response: {
        200: Type.Object({
          leadsTotal: Type.Number(),
          appointmentScheduledTotal: Type.Number(),
          appointmentsToday: Type.Number(),
          revenuePaid: Type.Number(),
          chargesOverdueCount: Type.Number(),
          chargesOverdueAmount: Type.Number(),
          escalationsCount: Type.Number(),
          noShowRate: Type.Number(),
        }),
      },
    },
  }, async (req) => getStatsOverview(fastify.db, req.tenantId, req.query))

  fastify.get<{
    Querystring: { funnelId?: string }
  }>('/funnel', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: Type.Object({
        funnelId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
      response: {
        200: Type.Object({
          byStage: Type.Array(
            Type.Object({
              stageId: Type.String(),
              stageName: Type.String(),
              funnelName: Type.String(),
              count: Type.Number(),
            }),
          ),
        }),
      },
    },
  }, async (req) => getStatsFunnel(fastify.db, req.tenantId, req.query))

  fastify.get<{
    Querystring: { from?: string; to?: string; professionalId?: string }
  }>('/agenda', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: Type.Object({
        from: datePattern,
        to: datePattern,
        professionalId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
      response: {
        200: Type.Object({
          byDay: Type.Array(
            Type.Object({
              date: Type.String(),
              total: Type.Number(),
              pending: Type.Number(),
              confirmed: Type.Number(),
              completed: Type.Number(),
              cancelled: Type.Number(),
              noShow: Type.Number(),
            }),
          ),
        }),
      },
    },
  }, async (req) => {
    const { from, to } = req.query
    const today = new Date().toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
    return getStatsAgenda(fastify.db, req.tenantId, {
      from: from ?? today,
      to: to ?? today,
      professionalId: req.query.professionalId,
    })
  })

  fastify.get<{
    Querystring: { from?: string; to?: string }
  }>('/revenue', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: Type.Object({
        from: datePattern,
        to: datePattern,
      }),
      response: {
        200: Type.Object({
          paid: Type.Number(),
          paidCount: Type.Number(),
          pending: Type.Number(),
          pendingCount: Type.Number(),
          overdue: Type.Number(),
          overdueCount: Type.Number(),
        }),
      },
    },
  }, async (req) => getStatsRevenue(fastify.db, req.tenantId, req.query))

  fastify.get<{
    Querystring: { from?: string; to?: string }
  }>('/agent', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: Type.Object({
        from: datePattern,
        to: datePattern,
      }),
      response: {
        200: Type.Object({
          messagesFromAgent: Type.Number(),
          escalations: Type.Number(),
          guardrailViolations: Type.Number(),
          guardrailBlocked: Type.Number(),
          resolutionRate: Type.Number(),
          totalInputTokens: Type.Number(),
          totalOutputTokens: Type.Number(),
        }),
      },
    },
  }, async (req) => getStatsAgent(fastify.db, req.tenantId, req.query))
}
