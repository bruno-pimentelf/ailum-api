import Anthropic from '@anthropic-ai/sdk'
import type { FastifyInstance } from 'fastify'
import { env } from '../../config/env.js'
import type { AgentContext } from '../../types/context.js'
import { extractJson } from './parse-json.js'
import type { ToolCallRecord } from './stage.agent.js'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

export type GuardrailSeverity = 'low' | 'medium' | 'high'

export interface GuardrailResult {
  approved: boolean
  violation: string | null
  severity: GuardrailSeverity | null
  safeReply: string | null
}

const SYSTEM_PROMPT = `Você é um verificador de segurança para respostas de assistentes em clínicas médicas.

Analise a resposta do assistente e verifique se ela viola alguma das regras abaixo.

VIOLAÇÕES CRÍTICAS (severity: high):
- Diagnóstico médico (ex: "você tem depressão", "parece ser ansiedade")
- Promessa de resultado terapêutico (ex: "vai curar", "garanto que vai melhorar")
- Conteúdo que pode causar dano imediato a pessoa em crise

VIOLAÇÕES GRAVES (severity: medium):
- Valor de PIX diferente dos serviços disponíveis
- Informação clínica inventada (horários, profissionais, preços incorretos)
- Menção depreciativa a concorrentes

VIOLAÇÕES LEVES (severity: low):
- Tom inadequado (agressivo, irônico, excessivamente informal)
- Markdown em resposta de WhatsApp (**, ##, listas com -)
- Resposta muito longa para WhatsApp (mais de 500 chars sem necessidade)

Retorne JSON:
{
  "approved": true|false,
  "violation": "descrição da violação ou null",
  "severity": "low"|"medium"|"high"|null
}

Se não houver violação: { "approved": true, "violation": null, "severity": null }
Responda APENAS o JSON, sem explicação.`

const LOW_SEVERITY_REPLY =
  'Estamos verificando as informações para você. Um momento.'

export async function applyGuardrails(
  reply: string,
  toolCalls: ToolCallRecord[],
  context: AgentContext,
  fastify: FastifyInstance,
): Promise<GuardrailResult> {
  const toolSummary =
    toolCalls.length > 0
      ? `\n\nFERRAMENTAS EXECUTADAS:\n${toolCalls.map((t) => `- ${t.name}: ${JSON.stringify(t.input)}`).join('\n')}`
      : ''

  const userContent = `REGRAS ESPECÍFICAS DA CLÍNICA:
${context.tenant.guardrailRules ?? '(nenhuma regra específica)'}

RESPOSTA A VERIFICAR:
${reply}${toolSummary}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const parsed = extractJson<Omit<GuardrailResult, 'safeReply'>>(text)
    if (!parsed) {
      return { approved: true, violation: null, severity: null, safeReply: null }
    }

    if (parsed.approved) {
      return { approved: true, violation: null, severity: null, safeReply: null }
    }

    // Handle by severity
    const severity = parsed.severity ?? 'low'

    if (severity === 'low') {
      // Replace with safe waiting message
      return {
        approved: false,
        violation: parsed.violation,
        severity,
        safeReply: LOW_SEVERITY_REPLY,
      }
    }

    if (severity === 'medium') {
      // Log violation and block
      await fastify.db.guardrailViolation.create({
        data: {
          tenantId: context.tenant.id,
          contactId: context.contact.id,
          originalResponse: reply,
          violation: parsed.violation ?? 'Violação detectada',
          severity,
          wasBlocked: true,
        },
      })
      return {
        approved: false,
        violation: parsed.violation,
        severity,
        safeReply: 'Vou verificar essa informação com um especialista e retorno em breve.',
      }
    }

    // HIGH — block, log, alert
    await fastify.db.guardrailViolation.create({
      data: {
        tenantId: context.tenant.id,
        contactId: context.contact.id,
        originalResponse: reply,
        violation: parsed.violation ?? 'Violação crítica detectada',
        severity,
        wasBlocked: true,
      },
    })

    fastify.log.error(
      {
        contactId: context.contact.id,
        tenantId: context.tenant.id,
        violation: parsed.violation,
        reply,
      },
      'guardrail:HIGH_SEVERITY_VIOLATION',
    )

    return {
      approved: false,
      violation: parsed.violation,
      severity,
      safeReply:
        'Compreendo sua situação. Para esse assunto, é melhor falar diretamente com um de nossos profissionais. Posso agendar um atendimento para você?',
    }
  } catch {
    // Never block on technical failure — fail open
    return { approved: true, violation: null, severity: null, safeReply: null }
  }
}
