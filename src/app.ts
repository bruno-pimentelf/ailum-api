import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import { env } from './config/env.js'

// Infrastructure plugins
import sensiblePlugin from './plugins/sensible.js'
import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import firebasePlugin from './plugins/firebase.js'
import authPlugin from './plugins/auth.js'

// API modules
import { contactsRoutes } from './modules/contacts/contacts.routes.js'
import { schedulingRoutes } from './modules/scheduling/scheduling.routes.js'
import { billingRoutes } from './modules/billing/billing.routes.js'
import { funnelsRoutes } from './modules/funnels/funnels.routes.js'
import { professionalsRoutes } from './modules/professionals/professionals.routes.js'
import { servicesRoutes } from './modules/services/services.routes.js'
import { membersRoutes } from './modules/members/members.routes.js'
import { voicesRoutes } from './modules/voices/voices.routes.js'
import { integrationsRoutes } from './modules/integrations/integrations.routes.js'
import { conversationsRoutes } from './modules/conversations/conversations.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { agentRoutes } from './modules/agent/agent.routes.js'
import { tenantRoutes } from './modules/tenant/tenant.routes.js'
import { zapiWebhookRoutes } from './modules/webhooks/zapi.webhook.js'
import { asaasWebhookRoutes } from './modules/webhooks/asaas.webhook.js'

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
    },
    trustProxy: true,
    // base64 de imagem/audio/video pode ser grande — 25mb cobre a maioria dos casos
    // (WhatsApp limita imagem a ~16mb, audio a ~16mb, video a ~64mb via URL)
    bodyLimit: 25 * 1024 * 1024,
  })

  // ── Security ───────────────────────────────────────────────────────────────
  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false, // managed by frontend
  })

  const extraOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : []

  const allowedOrigins = [env.WEB_URL, env.APP_URL, ...extraOrigins]

  await fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })

  // Global rate limit — stricter overrides applied per scope below
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${ctx.ttl}ms.`,
      statusCode: 429,
    }),
  })

  // ── Infrastructure plugins (order matters — each depends on the previous) ──
  await fastify.register(sensiblePlugin)
  await fastify.register(dbPlugin)
  await fastify.register(redisPlugin)
  await fastify.register(firebasePlugin)
  await fastify.register(authPlugin)

  // ── Health check ───────────────────────────────────────────────────────────
  fastify.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
    env: env.NODE_ENV,
  }))

  // ── API v1 modules ─────────────────────────────────────────────────────────
  await fastify.register(
    async (v1) => {
      await v1.register(contactsRoutes, { prefix: '/contacts' })
      await v1.register(schedulingRoutes, { prefix: '/appointments' })
      await v1.register(schedulingRoutes, { prefix: '/scheduling' })
      await v1.register(billingRoutes, { prefix: '/charges' })
      await v1.register(funnelsRoutes, { prefix: '/funnels' })
      await v1.register(professionalsRoutes, { prefix: '/professionals' })
      await v1.register(servicesRoutes, { prefix: '/services' })
      await v1.register(membersRoutes, { prefix: '/members' })
      await v1.register(voicesRoutes, { prefix: '/voices' })
      await v1.register(integrationsRoutes, { prefix: '/integrations' })
      await v1.register(conversationsRoutes, { prefix: '/conversations' })
      await v1.register(authRoutes, { prefix: '/auth' })
      await v1.register(tenantRoutes, { prefix: '/tenant' })

      // Agent — stricter rate limit (20/min per IP)
      await v1.register(
        async (agentScope) => {
          await agentScope.register(rateLimit, { max: 20, timeWindow: '1 minute' })
          await agentScope.register(agentRoutes)
        },
        { prefix: '/agent' },
      )
    },
    { prefix: '/v1' },
  )

  // ── Webhooks (10/min, no JWT auth) ─────────────────────────────────────────
  await fastify.register(
    async (webhooks) => {
      await webhooks.register(rateLimit, { max: 10, timeWindow: '1 minute' })
      await webhooks.register(zapiWebhookRoutes)
      await webhooks.register(asaasWebhookRoutes)
    },
    { prefix: '/webhooks' },
  )

  // ── Global error handler ───────────────────────────────────────────────────
  fastify.setErrorHandler(
    (error: Error & { statusCode?: number; code?: string; validation?: unknown }, request, reply) => {
      const status = error.statusCode ?? 500
      const isProd = env.NODE_ENV === 'production'

      request.log.error(
        {
          err: { message: error.message, code: error.code, stack: isProd ? undefined : error.stack },
          method: request.method,
          url: request.url,
          status,
        },
        'request:error',
      )

      // Validation errors (Fastify schema validation)
      if (error.validation) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          message: error.message,
        })
      }

      // Don't leak internal details in production
      if (status >= 500) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: isProd ? 'An unexpected error occurred' : error.message,
        })
      }

      return reply.status(status).send({
        statusCode: status,
        error: error.message,
        code: error.code,
      })
    },
  )

  // ── 404 handler ────────────────────────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    })
  })

  return fastify
}
