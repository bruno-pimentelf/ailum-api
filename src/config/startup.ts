import type { PrismaClient } from '../generated/prisma/client.js'
import type { Redis } from 'ioredis'
import type { Firestore } from 'firebase-admin/firestore'

interface StartupDeps {
  db: PrismaClient
  redis: Redis
  firestore: Firestore
}

/**
 * Validates all external dependencies before the server accepts traffic.
 * Throws a descriptive error if any dependency is unreachable.
 */
export async function validateStartup(deps: StartupDeps): Promise<void> {
  const errors: string[] = []

  // ── PostgreSQL ─────────────────────────────────────────────────────────────
  try {
    await deps.db.$queryRaw`SELECT 1`
  } catch (err) {
    errors.push(`PostgreSQL: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Redis ──────────────────────────────────────────────────────────────────
  try {
    const pong = await deps.redis.ping()
    if (pong !== 'PONG') {
      errors.push('Redis: unexpected response to PING')
    }
  } catch (err) {
    errors.push(`Redis: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Firebase Firestore ─────────────────────────────────────────────────────
  try {
    // listCollections() makes an actual gRPC call to Firestore
    await deps.firestore.listCollections()
  } catch (err) {
    errors.push(`Firebase Firestore: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (errors.length > 0) {
    throw new Error(
      `Startup validation failed — the following dependencies are unavailable:\n${errors
        .map((e) => `  • ${e}`)
        .join('\n')}\n\nCheck your .env and make sure all services are running.`,
    )
  }
}
