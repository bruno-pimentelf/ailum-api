import type { FastifyInstance } from 'fastify'
import {
  FunnelParamsSchema, StageParamsSchema, TriggerParamsSchema,
  CreateFunnelSchema, UpdateFunnelSchema,
  CreateStageSchema, UpdateStageSchema,
  UpsertAgentConfigSchema,
  CreateTriggerSchema, UpdateTriggerSchema,
} from './funnels.schema.js'
import {
  listFunnels, createFunnel, updateFunnel, deleteFunnel,
  listStages, createStage, updateStage, deleteStage,
  getStageAgentConfig, upsertStageAgentConfig,
  listTriggers, createTrigger, updateTrigger, deleteTrigger, toggleTrigger,
} from './funnels.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function funnelsRoutes(fastify: FastifyInstance) {
  // ── Funnels ─────────────────────────────────────────────────────────────────
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_READ)],
  }, async (req) => listFunnels(fastify.db, req.tenantId))

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { body: CreateFunnelSchema },
  }, async (req, reply) => reply.status(201).send(await createFunnel(fastify.db, req.tenantId, req.body as never)))

  fastify.patch('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: FunnelParamsSchema, body: UpdateFunnelSchema },
  }, async (req) => updateFunnel(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: FunnelParamsSchema },
  }, async (req) => deleteFunnel(fastify.db, req.tenantId, (req.params as { id: string }).id))

  // ── Stages ───────────────────────────────────────────────────────────────────
  fastify.get('/:id/stages', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_READ)],
    schema: { params: FunnelParamsSchema },
  }, async (req) => listStages(fastify.db, req.tenantId, (req.params as { id: string }).id))

  fastify.post('/:id/stages', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: FunnelParamsSchema, body: CreateStageSchema },
  }, async (req, reply) => {
    const stage = await createStage(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never)
    return reply.status(201).send(stage)
  })

  // ── Stages by stageId ────────────────────────────────────────────────────────
  fastify.patch('/stages/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: StageParamsSchema, body: UpdateStageSchema },
  }, async (req) => updateStage(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/stages/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: StageParamsSchema },
  }, async (req) => deleteStage(fastify.db, fastify, req.tenantId, (req.params as { id: string }).id))

  // ── Stage Agent Config ────────────────────────────────────────────────────────
  fastify.get('/stages/:id/agent-config', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.AGENT_CONFIG_READ)],
    schema: { params: StageParamsSchema },
  }, async (req, reply) => {
    const cfg = await getStageAgentConfig(fastify.db, req.tenantId, (req.params as { id: string }).id)
    if (!cfg) return reply.notFound('No agent config for this stage')
    return cfg
  })

  fastify.put('/stages/:id/agent-config', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.AGENT_CONFIG_WRITE)],
    schema: { params: StageParamsSchema, body: UpsertAgentConfigSchema },
  }, async (req) => upsertStageAgentConfig(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  // ── Triggers ──────────────────────────────────────────────────────────────────
  fastify.get('/stages/:id/triggers', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_READ)],
    schema: { params: StageParamsSchema },
  }, async (req) => listTriggers(fastify.db, req.tenantId, (req.params as { id: string }).id))

  fastify.post('/stages/:id/triggers', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: StageParamsSchema, body: CreateTriggerSchema },
  }, async (req, reply) => {
    const trigger = await createTrigger(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never)
    return reply.status(201).send(trigger)
  })

  fastify.patch('/triggers/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: TriggerParamsSchema, body: UpdateTriggerSchema },
  }, async (req) => updateTrigger(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/triggers/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: TriggerParamsSchema },
  }, async (req) => deleteTrigger(fastify.db, req.tenantId, (req.params as { id: string }).id))

  fastify.patch('/triggers/:id/toggle', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.FUNNELS_WRITE)],
    schema: { params: TriggerParamsSchema },
  }, async (req, reply) => {
    const trigger = await toggleTrigger(fastify.db, req.tenantId, (req.params as { id: string }).id)
    if (!trigger) return reply.notFound('Trigger not found')
    return trigger
  })
}
