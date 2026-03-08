import fp from 'fastify-plugin'
import sensible from '@fastify/sensible'
import type { FastifyInstance } from 'fastify'

async function sensiblePlugin(fastify: FastifyInstance) {
  await fastify.register(sensible)
}

export default fp(sensiblePlugin, { name: 'sensible' })
