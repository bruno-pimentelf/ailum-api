import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { syncContactPhoto } from '../services/contact-photo.service.js'
import { env } from '../config/env.js'

export interface PhotoSyncJobData {
  tenantId: string
  contactId: string
}

export function createPhotoSyncWorker(fastify: FastifyInstance) {
  return new Worker<PhotoSyncJobData>(
    'photo-sync',
    async (job) => {
      const { tenantId, contactId } = job.data

      if (!fastify.firebase.storage) {
        job.log('photo-sync:skipped — Firebase Storage not configured')
        return { status: 'skipped' }
      }

      const photoUrl = await syncContactPhoto(
        fastify.db,
        fastify.firebase.storage,
        fastify.firebase.firestore,
        fastify.log,
        tenantId,
        contactId,
      )

      job.log(`photo-sync:done contactId=${contactId} photoUrl=${photoUrl ?? 'none'}`)
      return { status: photoUrl ? 'synced' : 'no_photo', photoUrl }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5,
    },
  )
}
