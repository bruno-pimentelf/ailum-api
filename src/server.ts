import { buildApp } from './app.js'
import { env } from './config/env.js'
import { validateStartup } from './config/startup.js'
import { createAgentWorker } from './jobs/agent.job.js'
import { createTriggerWorker, scheduleTriggerScan } from './jobs/trigger-engine.job.js'
import { createReminderWorker, scheduleReminderScan } from './jobs/reminder.job.js'
import { createPixExpireWorker, schedulePixExpireScan } from './jobs/pix-expire.job.js'
import { createMemoryConsolidationWorker } from './jobs/memory-consolidation.job.js'
import { createSlotRecallWorker } from './jobs/slot-recall.job.js'
import { createPhotoSyncWorker } from './jobs/photo-sync.job.js'
import type { Worker } from 'bullmq'

async function start() {
  console.log('[startup] Building app…')
  const app = await buildApp()

  // ── Validate all external dependencies ─────────────────────────────────────
  try {
    app.log.info('Validating startup dependencies…')
    await validateStartup({
      db: app.db,
      redis: app.redis,
      firestore: app.firebase.firestore ?? null,
    })
    app.log.info('All dependencies are healthy ✓')
  } catch (err) {
    app.log.fatal({ err }, 'Startup validation failed — aborting')
    process.exit(1)
  }

  // ── Start BullMQ workers ────────────────────────────────────────────────────
  const workers: Worker[] = [
    createAgentWorker(app),
    createTriggerWorker(app),
    createReminderWorker(app),
    createPixExpireWorker(app),
    createMemoryConsolidationWorker(app),
    createSlotRecallWorker(app),
    createPhotoSyncWorker(app),
  ]

  // ── Schedule repeatable cron jobs ───────────────────────────────────────────
  await Promise.all([
    scheduleTriggerScan(),
    scheduleReminderScan(),
    schedulePixExpireScan(),
  ])

  app.log.info({ workers: workers.length }, 'BullMQ workers started')

  // ── Start HTTP server ───────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    app.log.info(`Server running at http://0.0.0.0:${env.PORT} [${env.NODE_ENV}]`)
  } catch (err) {
    app.log.fatal({ err }, 'Failed to start HTTP server')
    process.exit(1)
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully…`)
    try {
      // Close workers first so no new jobs start during drain
      await Promise.all(workers.map((w) => w.close()))
      app.log.info('BullMQ workers closed')

      // Close Fastify (runs onClose hooks: db.$disconnect, redis.quit, etc.)
      await app.close()
      app.log.info('Server closed cleanly')
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException')
    void shutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ reason }, 'unhandledRejection')
    void shutdown('unhandledRejection')
  })
}

start().catch((err) => {
  console.error('[startup] Fatal: failed to start application')
  console.error(err)
  process.exit(1)
})
