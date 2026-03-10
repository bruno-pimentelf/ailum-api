/**
 * Simula digitação humana: divide mensagem em partes e calcula delays.
 * Baseado em tempos médios de leitura (~200 palavras/min) e digitação (~40 palavras/min).
 */

const MS_PER_WORD_READING = 180
const MS_PER_WORD_TYPING = 120
const BASE_DELAY_BEFORE_REPLY_MS = 1200
const BASE_DELAY_BETWEEN_CHUNKS_MS = 900
const MAX_DELAY_BEFORE_MS = 5500
const MAX_DELAY_BETWEEN_MS = 3200
const MIN_CHUNK_LENGTH = 50

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Protege abreviações para não cortar (ex: "Dr. Bruno" fica junto) */
const PROTECT_ABBREV = /\b(Dr\.?|Dra\.?|Sr\.?|Sra\.?|Srta\.?|Prof\.?)\s+/gi

/** Divide o texto em partes naturais (frases) para parecer mais humano. */
export function splitIntoChunks(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const toSplit = trimmed.replace(PROTECT_ABBREV, (m) => m.replace(/\s+$/, '\x01'))
  const sentences = toSplit
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\x01/g, ' ').trim())
    .filter(Boolean)

  if (sentences.length <= 1) return [trimmed]

  const chunks: string[] = []
  let acc = ''

  for (const s of sentences) {
    const next = acc ? `${acc} ${s}` : s
    if (next.length >= MIN_CHUNK_LENGTH) {
      chunks.push(next)
      acc = ''
    } else {
      acc = next
    }
  }
  if (acc) chunks.push(acc)

  return chunks
}

/** Delay antes de começar a "responder" (simula leitura da mensagem do usuário). */
export function computeDelayBeforeReply(userMessageWordCount: number): number {
  const extra = userMessageWordCount * MS_PER_WORD_READING
  return Math.min(
    BASE_DELAY_BEFORE_REPLY_MS + extra,
    MAX_DELAY_BEFORE_MS,
  )
}

/** Delay entre cada parte enviada (simula digitação). */
export function computeDelayBetweenChunks(chunkWordCount: number): number {
  const extra = chunkWordCount * MS_PER_WORD_TYPING
  return Math.min(
    BASE_DELAY_BETWEEN_CHUNKS_MS + extra,
    MAX_DELAY_BETWEEN_MS,
  )
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
