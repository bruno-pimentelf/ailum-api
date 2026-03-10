/**
 * Extrai JSON de resposta de LLM que pode vir envolvido em ``` ou com texto antes/depois.
 */
export function extractJson<T>(raw: string): T | null {
  let s = raw.trim()
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(s)
  if (codeBlock) s = codeBlock[1].trim()
  const objMatch = s.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T
    } catch {
      /* fall through */
    }
  }
  const arrMatch = s.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]) as T
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
