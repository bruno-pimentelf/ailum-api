import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex')
}

/**
 * Encrypts text using AES-256-GCM.
 * Output format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encrypt(text: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Decrypts a string produced by encrypt().
 */
export function decrypt(encoded: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':')

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted string format')
  }

  const key = getKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}
