import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import type { AgentContext } from '../../types/context.js'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

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

Analise a mensagem do contato e retorne um JSON com:
- intent: uma das intenções válidas
- confidence: número de 0 a 1 indicando sua certeza
- shouldEscalate: boolean se deve escalar para humano
- escalationReason: string explicando o motivo (ou null)
- suggestedFunnelId: ID de funil sugerido caso mude de contexto (ou null)

INTENÇÕES VÁLIDAS:
- WANTS_SCHEDULE: quer agendar consulta
- WANTS_PRICE: quer saber preço ou forma de pagamento
- WANTS_INFO: quer informação sobre serviço, especialidade ou clínica
- WANTS_CANCEL: quer cancelar consulta
- CONFIRMING: confirmando algo (sim, confirmo, pode ser, etc.)
- OBJECTION: objeção a preço, horário ou condição
- CRISIS: situação de crise, emergência, pensamentos suicidas, violência
- GENERAL_QUESTION: pergunta genérica que não se encaixa nas demais
- GREETING: apenas saudação sem intenção clara
- NO_INTEREST: não tem interesse, pediu para parar de enviar mensagens
- IS_PATIENT: identifica que já é paciente da clínica
- WANTS_RESCHEDULE: quer remarcar consulta existente

REGRAS:
- CRISIS sempre deve ter shouldEscalate: true
- confidence < 0.70 deve ter shouldEscalate: true
- Responda APENAS o JSON, sem markdown, sem explicação`

export async function routeMessage(
  message: string,
  context: AgentContext,
): Promise<RouterResult> {
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
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const parsed = JSON.parse(text.trim()) as RouterResult

    // Enforce CRISIS escalation regardless of confidence
    if (parsed.intent === 'CRISIS') {
      parsed.shouldEscalate = true
      parsed.escalationReason = parsed.escalationReason ?? 'Situação de crise detectada'
    }

    // Enforce low-confidence escalation
    if (parsed.confidence < 0.7) {
      parsed.shouldEscalate = true
      parsed.escalationReason =
        parsed.escalationReason ?? `Baixa confiança na classificação (${parsed.confidence})`
    }

    return parsed
  } catch {
    return {
      intent: 'GENERAL_QUESTION',
      confidence: 0.5,
      shouldEscalate: false,
      escalationReason: null,
      suggestedFunnelId: null,
    }
  }
}
