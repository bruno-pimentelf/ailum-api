import { Type } from '@sinclair/typebox'
import type { TObject } from '@sinclair/typebox'

export interface AgentToolDefinition {
  name: string
  description: string
  input_schema: TObject
}

export const AGENT_TOOLS = {
  search_availability: {
    name: 'search_availability',
    description: `Busca horários disponíveis para uma data. Chamar quando o usuário indicar um dia (ex: "amanhã", "terça", "10/03", "próxima semana").
Retorna profissionais com id, nome, serviços (id, nome, duração, preço) e slots (time, endTime).
Quando retorna 0 profissionais, o resultado inclui "diagnostic" com: profissionais ativos, se têm disponibilidade para o dia, se têm serviços de consulta vinculados, exceções. Use esse contexto para responder ao usuário de forma útil (ex: sugerir verificar vinculação de serviços ao profissional).`,
    input_schema: Type.Object({
      date: Type.String({
        description: 'Data no formato YYYY-MM-DD (ex: 2026-03-10 para 10 de março de 2026)',
      }),
    }),
  },

  create_appointment: {
    name: 'create_appointment',
    description: `Cria o agendamento após o contato confirmar data, horário, profissional e serviço.
ATENÇÃO: professional_id e service_id são UUIDs DIFERENTES. professional_id = professional.id; service_id = professional.services[].id.
SEMPRE use os IDs do retorno de search_availability: professional.id → professional_id; um dos professional.services[].id → service_id.
scheduled_at: combine data + slot (ex: slot "09:00" e data 2026-03-10 → "2026-03-10T09:00:00-03:00"). Formato ISO 8601 com -03:00.`,
    input_schema: Type.Object({
      professional_id: Type.String({
        format: 'uuid',
        description: 'professional.id — UUID do profissional (NÃO é o mesmo que service_id)',
      }),
      service_id: Type.String({
        format: 'uuid',
        description: 'professional.services[].id — UUID do serviço desse profissional (NÃO é o mesmo que professional_id)',
      }),
      scheduled_at: Type.String({
        format: 'date-time',
        description: 'Datetime ISO 8601 com -03:00 (ex: 2026-03-10T09:00:00-03:00)',
      }),
      notes: Type.Optional(Type.String({ description: 'Observações adicionais para a consulta' })),
    }),
  },

  generate_pix: {
    name: 'generate_pix',
    description:
      'Gera cobrança PIX para o contato via Asaas. Use após o agendamento ser confirmado e quando o pagamento for necessário.',
    input_schema: Type.Object({
      amount: Type.Number({
        minimum: 1,
        description: 'Valor da cobrança em BRL (ex: 150.00)',
      }),
      description: Type.String({ description: 'Descrição da cobrança exibida ao paciente' }),
      appointment_id: Type.Optional(
        Type.String({ format: 'uuid', description: 'UUID da consulta relacionada' }),
      ),
      due_hours: Type.Optional(
        Type.Number({
          minimum: 1,
          default: 24,
          description: 'Horas até o PIX expirar',
        }),
      ),
    }),
  },

  move_stage: {
    name: 'move_stage',
    description:
      'Move o contato para outro estágio do funil. Use quando o resultado da conversa justificar mudança de estágio.',
    input_schema: Type.Object({
      stage_id: Type.String({ format: 'uuid', description: 'UUID do estágio de destino' }),
      reason: Type.Optional(Type.String({ description: 'Motivo da mudança de estágio' })),
    }),
  },

  notify_operator: {
    name: 'notify_operator',
    description:
      'Transfere a conversa para um operador humano. Use quando: o contato está irritado, pede um humano, ou o assunto está fora do escopo do agente.',
    input_schema: Type.Object({
      reason: Type.String({
        description: 'Breve explicação do motivo da intervenção humana',
      }),
      urgency: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], {
        default: 'medium',
        description: 'Nível de urgência para o operador',
      }),
    }),
  },

  send_message: {
    name: 'send_message',
    description:
      'Envia mensagem WhatsApp para o contato. Use para enviar informações, confirmações ou mensagens de acompanhamento.',
    input_schema: Type.Object({
      content: Type.String({
        minLength: 1,
        maxLength: 4096,
        description: 'Texto da mensagem a enviar via WhatsApp',
      }),
      type: Type.Optional(
        Type.Union(
          [
            Type.Literal('TEXT'),
            Type.Literal('IMAGE'),
            Type.Literal('AUDIO'),
            Type.Literal('DOCUMENT'),
          ],
          { default: 'TEXT' },
        ),
      ),
      media_url: Type.Optional(
        Type.String({ format: 'uri', description: 'URL da mídia a enviar (para tipos não-texto)' }),
      ),
    }),
  },
} as const satisfies Record<string, AgentToolDefinition>

export type AgentToolName = keyof typeof AGENT_TOOLS
