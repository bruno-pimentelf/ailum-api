import { getLLM, resolveModel } from '../../services/llm/llm.service.js'
import type { AgentContext } from '../../types/context.js'


export type RouterIntent =
  | 'WANTS_SCHEDULE'
  | 'WANTS_PRICE'
  | 'WANTS_INFO'
  | 'WANTS_CANCEL'
  | 'CONFIRMING'
  | 'OBJECTION'
  | 'CRISIS'
  | 'GENERAL_QUESTION'
  | 'GREETING'
  | 'NO_INTEREST'
  | 'IS_PATIENT'
  | 'WANTS_RESCHEDULE'

export interface RouterResult {
  intent: RouterIntent
  confidence: number
  shouldEscalate: boolean
  escalationReason: string | null
  suggestedFunnelId: string | null
}

const SYSTEM_PROMPT = `Você é um classificador de intenção para clínicas médicas brasileiras.

Analise a mensagem do contato e retorne APENAS um único objeto JSON válido, sem texto antes ou depois, com exatamente estes campos:
- intent: uma das intenções válidas (exatamente como escritas abaixo)
- confidence: número entre 0 e 1 (use 0.9 ou mais quando a intenção for óbvia)
- shouldEscalate: boolean (true apenas se CRISIS ou confidence < 0.7)
- escalationReason: string ou null
- suggestedFunnelId: string ou null

INTENÇÕES VÁLIDAS:
- WANTS_SCHEDULE: quer agendar ou escolher horário (ex: "quero agendar", "quero 9h", "marca às 9:00", "quero hoje", "pode ser amanhã")
- WANTS_PRICE: quer saber preço ou forma de pagamento
- WANTS_INFO: quer informação (ex: "quais profissionais", "horários disponíveis", "quem atende")
- WANTS_CANCEL: quer cancelar consulta
- CONFIRMING: confirmando (ex: "sim", "confirmo", "está certo", "pode ser", "isso mesmo", "correto")
- OBJECTION: objeção a preço, horário ou condição
- CRISIS: situação de crise, emergência, pensamentos suicidas
- GENERAL_QUESTION: pergunta genérica que não se encaixa nas demais
- GREETING: APENAS saudação pura sem outro conteúdo (ex: "oi", "olá", "bom dia"). Se incluir pedido ("oi, quero marcar consulta"), NÃO é GREETING.
- NO_INTEREST: não tem interesse
- IS_PATIENT: já é paciente
- WANTS_RESCHEDULE: quer remarcar consulta

EXEMPLOS (retorne JSON no mesmo formato):
- "Quero 9:00", "pode ser às 9", "quero hoje" → intent: WANTS_SCHEDULE, confidence: 0.9
- "Sim", "confirmo", "está certo", "pode ser" (após proposta de horário ou pedido de confirmação) → intent: CONFIRMING, confidence: 0.95
- "10h", "9h", "às 10", "10:00" (resposta à pergunta "qual horário?") → intent: CONFIRMING, confidence: 0.95
- Mensagem com nome + CPF + telefone (ex: "Daniel Moreira, 19054112786, 27995072522") após pedido desses dados → intent: CONFIRMING, confidence: 0.95
- "Quero marcar uma consulta" ou "Oi, quero marcar uma consulta" → intent: WANTS_SCHEDULE, confidence: 0.95
- "Quais profissionais disponíveis?" → intent: WANTS_INFO, confidence: 0.9
- "Olá" sozinho → intent: GREETING, confidence: 0.9

REGRAS:
- CONTEXTO OBRIGATÓRIO: Se a ÚLTIMA mensagem do ASSISTENTE ofereceu horários (ex: "temos disponibilidade", "horários livres", "qual horário?", "10h, 13h, 14h") e a NOVA mensagem do contato é só um horário ("10h", "9h", "às 10") ou confirmação ("sim", "pode ser", "esse mesmo"), retorne SEMPRE intent: CONFIRMING e confidence: 0.95. O agente precisa disso para executar o agendamento.
- CRISIS → always shouldEscalate: true
- confidence < 0.70 → shouldEscalate: true
- Saudação + pedido = classifique pelo pedido ("oi, quero consulta" → WANTS_SCHEDULE)
- GENERAL_QUESTION só quando não encaixar em nenhuma outra
- Saída: somente um objeto JSON válido, sem \`\`\` e sem texto extra`

const VALID_INTENTS: RouterIntent[] = [
  'WANTS_SCHEDULE',
  'WANTS_PRICE',
  'WANTS_INFO',
  'WANTS_CANCEL',
  'CONFIRMING',
  'OBJECTION',
  'CRISIS',
  'GENERAL_QUESTION',
  'GREETING',
  'NO_INTEREST',
  'IS_PATIENT',
  'WANTS_RESCHEDULE',
]

function normalizeParsed(parsed: Record<string, unknown>): RouterResult {
  let intent = parsed.intent
  if (typeof intent !== 'string' || !VALID_INTENTS.includes(intent as RouterIntent)) {
    intent = 'GENERAL_QUESTION'
  }
  let confidenceNum: number
  const c = parsed.confidence
  if (typeof c === 'number' && !Number.isNaN(c)) {
    confidenceNum = c
  } else if (typeof c === 'string') {
    confidenceNum = parseFloat(c)
  } else {
    confidenceNum = 0.7
  }
  const confidence = Math.max(0, Math.min(1, confidenceNum))
  return {
    intent: intent as RouterIntent,
    confidence,
    shouldEscalate: Boolean(parsed.shouldEscalate),
    escalationReason:
      typeof parsed.escalationReason === 'string' ? parsed.escalationReason : null,
    suggestedFunnelId:
      typeof parsed.suggestedFunnelId === 'string' ? parsed.suggestedFunnelId : null,
  }
}

function parseRouterJson(raw: string): RouterResult {
  let s = raw.trim()
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(s)
  if (codeBlock) s = codeBlock[1].trim()
  const jsonMatch = s.match(/\{[\s\S]*\}/)
  if (jsonMatch) s = jsonMatch[0]
  const parsed = JSON.parse(s) as Record<string, unknown>
  return normalizeParsed(parsed)
}

/** Detecta se a última mensagem do assistente foi oferta de horários OU pedido de confirmação para finalizar agendamento. */
function lastAssistantMessageOfferedSlots(messages: AgentContext['messages']): boolean {
  const lastFromAssistant = [...messages].reverse().find((m) => m.role === 'AGENT')
  if (!lastFromAssistant || typeof lastFromAssistant.content !== 'string') return false
  const text = lastFromAssistant.content.toLowerCase()
  const slotOrConfirmCues =
    /horário|horarios|disponibilidade|disponível|qual horário|qual período|período você prefere|temos (disponibilidade|horários)|livres?\b|(a partir das?|pela manhã|à tarde|\d{1,2}h|\d{1,2}:\d{2})|(às|as)\s+\d{1,2}h?|(me\s+)?confirma|finalizar o agendamento|para eu finalizar/i
  return slotOrConfirmCues.test(text)
}

/** Mensagem curta que é escolha de horário ou confirmação. */
function isShortTimeOrConfirmation(message: string): boolean {
  const m = message.trim().toLowerCase().replace(/\s+/g, ' ')
  if (m.length > 50) return false
  if (
    /^(sim|show|confirmo|confirmar|está certo|pode ser|isso mesmo|correto|desejo|por favor|esse mesmo|esse horário)$/.test(
      m,
    )
  )
    return true
  if (/^\d{1,2}h$/i.test(m)) return true
  if (/^\d{1,2}\s*:\s*\d{2}$/.test(m)) return true
  if (/^às?\s*\d{1,2}h?/i.test(m) || /^as\s*\d{1,2}h?/i.test(m)) return true
  return false
}

/** Fallback when LLM response fails to parse — infer intent from message content. */
function keywordFallback(message: string, context?: AgentContext): RouterResult {
  const m = message.toLowerCase().trim()
  const digitsOnly = m.replace(/\D/g, '')
  const hasCpfLike = /\d{11}/.test(digitsOnly) || /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(m.trim())
  const looksLikeNameAndDoc =
    /^[a-zà-ú\s]+[,:]?\s*\d{10,11}/.test(m) || (hasCpfLike && (m.includes(',') || m.includes('telefone')))
  if (
    /^(sim|confirmo|confirmar|está certo|pode ser|isso mesmo|correto|desejo|por favor)$/.test(
      m,
    ) ||
    looksLikeNameAndDoc
  ) {
    return {
      intent: 'CONFIRMING',
      confidence: 0.75,
      shouldEscalate: false,
      escalationReason: null,
      suggestedFunnelId: null,
    }
  }
  if (context && lastAssistantMessageOfferedSlots(context.messages) && isShortTimeOrConfirmation(message)) {
    return {
      intent: 'CONFIRMING',
      confidence: 0.95,
      shouldEscalate: false,
      escalationReason: null,
      suggestedFunnelId: null,
    }
  }
  if (
    /quero\s+(marcar|agendar)|marcar\s+(uma\s+)?consulta|agendar\s+(uma\s+)?consulta|^(quero|pode ser)\s+(com\s+)?(ele|eles|dr\.?|doutor)/i.test(
      m,
    ) ||
    /\b(horário|horarios|9h|09:00|às\s+9|as\s+9)\b/i.test(m)
  ) {
    return {
      intent: 'WANTS_SCHEDULE',
      confidence: 0.8,
      shouldEscalate: false,
      escalationReason: null,
      suggestedFunnelId: null,
    }
  }
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite)$/i.test(m)) {
    return {
      intent: 'GREETING',
      confidence: 0.8,
      shouldEscalate: false,
      escalationReason: null,
      suggestedFunnelId: null,
    }
  }
  return {
    intent: 'GENERAL_QUESTION',
    confidence: 0.5,
    shouldEscalate: true,
    escalationReason: 'Classificação falhou — fallback por palavras-chave',
    suggestedFunnelId: null,
  }
}

export async function routeMessage(
  message: string,
  context: AgentContext,
): Promise<RouterResult> {
  // Early return: se o assistente ofereceu horários e o contato respondeu com horário ou confirmação → CONFIRMING (garante create_appointment)
  if (
    lastAssistantMessageOfferedSlots(context.messages) &&
    isShortTimeOrConfirmation(message)
  ) {
    return {
      intent: 'CONFIRMING',
      confidence: 0.95,
      shouldEscalate: false,
      escalationReason: null,
      suggestedFunnelId: null,
    }
  }

  const recentMessages = context.messages
    .slice(-3)
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n')

  const userContent = `Stage atual: ${context.stage?.name ?? 'Sem stage'}
Funil atual: ${context.funnel?.name ?? 'Sem funil'}

Últimas mensagens:
${recentMessages || '(sem histórico)'}

Nova mensagem do contato: "${message}"`

  try {
    const llm = getLLM()
    const result = await llm.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { model: resolveModel('haiku'), maxTokens: 300, temperature: 0 },
    )
    const text = result.text

    let parsed: RouterResult
    try {
      parsed = parseRouterJson(text)
    } catch (parseErr) {
      // Log raw response for debugging (truncated)
      console.warn(
        '[router] parse failed, using keyword fallback. Raw (first 400 chars):',
        text.slice(0, 400),
      )
      console.warn('[router] parse error:', parseErr)
      return keywordFallback(message, context)
    }

    // Enforce CRISIS escalation regardless of confidence
    if (parsed.intent === 'CRISIS') {
      parsed.shouldEscalate = true
      parsed.escalationReason = parsed.escalationReason ?? 'Situação de crise detectada'
    }

    // Enforce low-confidence escalation (except when we used keyword fallback with decent confidence)
    if (parsed.confidence < 0.7) {
      parsed.shouldEscalate = true
      parsed.escalationReason =
        parsed.escalationReason ?? `Baixa confiança na classificação (${parsed.confidence})`
    }

    // Regra de contexto: se o assistente acabou de oferecer horários e o contato respondeu com horário ou "sim", forçar CONFIRMING para o agente executar create_appointment
    if (
      lastAssistantMessageOfferedSlots(context.messages) &&
      isShortTimeOrConfirmation(message) &&
      parsed.intent !== 'CONFIRMING'
    ) {
      parsed = {
        intent: 'CONFIRMING',
        confidence: 0.95,
        shouldEscalate: false,
        escalationReason: null,
        suggestedFunnelId: null,
      }
    }

    return parsed
  } catch (err) {
    console.warn('[router] request or parse failed, using keyword fallback:', err)
    return keywordFallback(message, context)
  }
}
