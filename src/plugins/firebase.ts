import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import admin from 'firebase-admin'
import type { App } from 'firebase-admin/app'
import type { Firestore } from 'firebase-admin/firestore'
import type { Storage } from 'firebase-admin/storage'
import { getStorage } from 'firebase-admin/storage'
import { env } from '../config/env.js'

export interface FirebaseDecorator {
  admin: App | null
  firestore: Firestore | null
  storage: Storage | null
}

async function firebasePlugin(fastify: FastifyInstance) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    fastify.log.warn('Firebase credentials not configured — Firestore sync disabled')
    fastify.decorate('firebase', { admin: null, firestore: null, storage: null })
    return
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    storageBucket: `${env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
  })

  const firestore = admin.firestore(app)
  firestore.settings({ ignoreUndefinedProperties: true })

  const storage = getStorage(app)

  fastify.decorate('firebase', { admin: app, firestore, storage })

  fastify.addHook('onClose', async () => {
    await app.delete()
  })
}

export default fp(firebasePlugin, { name: 'firebase' })
