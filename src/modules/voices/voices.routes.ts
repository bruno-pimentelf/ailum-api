import type { FastifyInstance } from 'fastify'
import { VoiceParamsSchema, CreateVoiceSchema, UpdateVoiceSchema } from './voices.schema.js'
import { listVoices, getVoiceById, createVoice, updateVoice, deleteVoice, setDefaultVoice } from './voices.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function voicesRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.VOICES_READ)],
  }, async (req) => listVoices(fastify.db, req.tenantId))

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.VOICES_READ)],
    schema: { params: VoiceParamsSchema },
  }, async (req, reply) => {
    const voice = await getVoiceById(fastify.db, req.tenantId, (req.params as { id: string }).id)
    if (!voice) return reply.notFound('Voice not found')
    return voice
  })

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.VOICES_WRITE)],
    schema: { body: CreateVoiceSchema },
  }, async (req, reply) => reply.status(201).send(await createVoice(fastify.db, req.tenantId, req.body as never)))

  fastify.patch('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.VOICES_WRITE)],
    schema: { params: VoiceParamsSchema, body: UpdateVoiceSchema },
  }, async (req) => updateVoice(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.VOICES_WRITE)],
    schema: { params: VoiceParamsSchema },
  }, async (req) => deleteVoice(fastify.db, req.tenantId, (req.params as { id: string }).id))

  fastify.patch('/:id/default', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.VOICES_WRITE)],
    schema: { params: VoiceParamsSchema },
  }, async (req) => setDefaultVoice(fastify.db, req.tenantId, (req.params as { id: string }).id))
}
