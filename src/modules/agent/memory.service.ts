import type { FastifyInstance } from 'fastify'
import { getLLM, resolveModel } from '../../services/llm/llm.service.js'
import type { ContextMessage } from '../../types/context.js'
import { extractJson } from './parse-json.js'


interface MemoryFact {
  key: string
  value: string
  confidence: number
}

const SYSTEM_PROMPT = `Você é um extrator de fatos sobre pacientes de clínica médica.

Analise as mensagens da conversa e extraia fatos relevantes e duradouros sobre o contato.

EXEMPLOS DE CHAVES VÁLIDAS:
- preferred_time: horário preferido de consulta
- main_complaint: queixa principal ou motivo de busca
- insurance: plano de saúde
- cancelled_once: se já cancelou consulta (true/false)
- price_sensitive: se demonstrou sensibilidade a preço
- preferred_professional: nome do profissional preferido (ex: Dr. Bruno, Dermatologista)
- preferred_weekday: dia da semana preferido (ex: segunda, segunda-feira)
- preferred_time_of_day: turno preferido (manhã, tarde, qualquer)
- wants_slot_on_cancellation: true se pediu para ser avisado quando abrir vaga (ex: "se alguém cancelar me coloca", "me avisa se abrir vaga")
- flexible_schedule: se aceita horários alternativos (true/false)
- preferred_service: serviço preferido quando há vários
- has_children: se tem filhos
- chronic_condition: condição crônica mencionada (nunca diagnóstico — apenas o que o paciente disse)
- location: bairro ou cidade
- contact_preference: como prefere ser contatado
- urgency: se demonstrou urgência no atendimento
- referral_source: como soube da clínica

REGRAS:
- Extraia apenas fatos claros e explícitos — sem inferências médicas
- Confidence entre 0.5 e 1.0 baseado em quão diretamente o fato foi dito
- Ignore informações já óbvias (nome, telefone — esses já estão no cadastro)
- Máximo 10 fatos por conversa
- Se não houver fatos relevantes: retorne array vazio []

Retorne APENAS um array JSON, sem markdown, sem explicação:
[{ "key": "...", "value": "...", "confidence": 0.9 }]`

export async function consolidateMemories(
  contactId: string,
  tenantId: string,
  messages: ContextMessage[],
  fastify: FastifyInstance,
): Promise<void> {
  if (messages.length < 2) return

  const conversationText = messages
    .slice(-20)
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n')

  try {
    const llm = getLLM()
    const result = await llm.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Conversa a analisar:\n\n${conversationText}` },
      ],
      { model: resolveModel('haiku'), maxTokens: 400, temperature: 0 },
    )
    const text = result.text.trim()

    const facts = extractJson<MemoryFact[]>(text)
    if (!facts || !Array.isArray(facts)) {
      if (text.length > 0) fastify.log.warn({ text: text.slice(0, 200) }, 'memory:consolidate:parse_error')
      return
    }

    if (!Array.isArray(facts) || facts.length === 0) return

    // Upsert each fact — update if key exists, create if not
    await Promise.all(
      facts.map((fact) =>
        fastify.db.agentMemory.upsert({
          where: { contactId_key: { contactId, key: fact.key } },
          update: {
            value: fact.value,
            confidence: fact.confidence,
            updatedAt: new Date(),
          },
          create: {
            tenantId,
            contactId,
            key: fact.key,
            value: fact.value,
            confidence: fact.confidence,
          },
        }),
      ),
    )

    fastify.log.debug(
      { contactId, factsCount: facts.length },
      'memory:consolidate:done',
    )
  } catch (err) {
    // Fire-and-forget — log but don't throw
    fastify.log.error({ err, contactId }, 'memory:consolidate:error')
  }
}
