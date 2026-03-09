import { Queue } from 'bullmq'
import { env } from '../config/env.js'

const connection = { url: env.REDIS_URL }

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
}

/** Processes incoming WhatsApp messages through the AI agent pipeline */
export const agentQueue = new Queue('agent', {
  connection,
  defaultJobOptions,
})

/** Executes funnel trigger actions (send message, move stage, generate PIX, etc.) */
export const triggerQueue = new Queue('trigger', {
  connection,
  defaultJobOptions,
})

/** Sends appointment reminder messages (24h, 2h before) */
export const reminderQueue = new Queue('reminder', {
  connection,
  defaultJobOptions,
})

/** Cancels PIX charges that were not paid within the expiry window */
export const pixExpireQueue = new Queue('pix-expire', {
  connection,
  defaultJobOptions,
})

/** Consolidates and deduplicates agent memories per contact */
export const memoryQueue = new Queue('memory-consolidation', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
  },
})

/** Downloads contact profile photos from Z-API and uploads to Firebase Storage */
export const photoSyncQueue = new Queue('photo-sync', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
    // Fotos são baixa prioridade — delay de 2s para não competir com mensagens
    delay: 2000,
  },
})

export const allQueues = [agentQueue, triggerQueue, reminderQueue, pixExpireQueue, memoryQueue, photoSyncQueue]
