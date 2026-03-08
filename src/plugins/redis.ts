import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { env } from '../config/env.js'

async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000)
      return delay
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED']
      return targetErrors.some((target) => err.message.includes(target))
    },
  })

  redis.on('error', (err) => {
    fastify.log.error({ err }, 'redis:error')
  })

  redis.on('connect', () => {
    fastify.log.info('redis:connected')
  })

  redis.on('reconnecting', () => {
    fastify.log.warn('redis:reconnecting')
  })

  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve)
    redis.once('error', reject)
  })

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
}

export default fp(redisPlugin, { name: 'redis' })
