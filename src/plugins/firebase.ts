import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import admin from 'firebase-admin'
import type { App } from 'firebase-admin/app'
import type { Firestore } from 'firebase-admin/firestore'
import { env } from '../config/env.js'

export interface FirebaseDecorator {
  admin: App
  firestore: Firestore
}

async function firebasePlugin(fastify: FastifyInstance) {
  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  })

  const firestore = admin.firestore(app)
  firestore.settings({ ignoreUndefinedProperties: true })

  fastify.decorate('firebase', { admin: app, firestore })

  fastify.addHook('onClose', async () => {
    await app.delete()
  })
}

export default fp(firebasePlugin, { name: 'firebase' })
