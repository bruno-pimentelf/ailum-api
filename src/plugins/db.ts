import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'

async function dbPlugin(fastify: FastifyInstance) {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
  const adapter = new PrismaPg(pool)

  const prisma = new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  })

  if (env.NODE_ENV === 'development') {
    prisma.$on('query', (e) => {
      fastify.log.debug({ query: e.query, params: e.params, duration: e.duration }, 'prisma:query')
    })
  }

  prisma.$on('warn', (e) => {
    fastify.log.warn({ message: e.message }, 'prisma:warn')
  })

  fastify.decorate('db', prisma)

  fastify.addHook('onClose', async () => {
    await pool.end()
  })
}

export default fp(dbPlugin, { name: 'db' })
