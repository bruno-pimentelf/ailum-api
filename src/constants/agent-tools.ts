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
      'Generate a PIX charge for the contact via Asaas. Use after appointment is scheduled and payment is required.',
    input_schema: Type.Object({
      amount: Type.Number({
        minimum: 1,
        description: 'Charge amount in BRL (e.g. 150.00)',
      }),
      description: Type.String({ description: 'Charge description shown to the patient' }),
      appointment_id: Type.Optional(
        Type.String({ format: 'uuid', description: 'UUID of the related appointment' }),
      ),
      due_hours: Type.Optional(
        Type.Number({
          minimum: 1,
          default: 24,
          description: 'Hours until the PIX expires',
        }),
      ),
    }),
  },

  move_stage: {
    name: 'move_stage',
    description:
      'Move the contact to a different stage within the current funnel. Use when the conversation outcome warrants a stage change.',
    input_schema: Type.Object({
      stage_id: Type.String({ format: 'uuid', description: 'UUID of the target stage' }),
      reason: Type.Optional(Type.String({ description: 'Reason for moving to this stage' })),
    }),
  },

  notify_operator: {
    name: 'notify_operator',
    description:
      'Hand off the conversation to a human operator. Use when: the contact is upset, asks for a human, or the issue is outside the agent scope.',
    input_schema: Type.Object({
      reason: Type.String({
        description: 'Brief explanation of why human intervention is needed',
      }),
      urgency: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], {
        default: 'medium',
        description: 'Urgency level for the operator',
      }),
    }),
  },

  send_message: {
    name: 'send_message',
    description:
      'Send a WhatsApp message to the contact. Use to send information, confirmations, or follow-up messages.',
    input_schema: Type.Object({
      content: Type.String({
        minLength: 1,
        maxLength: 4096,
        description: 'Message text to send via WhatsApp',
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
        Type.String({ format: 'uri', description: 'URL of the media to send (for non-text types)' }),
      ),
    }),
  },
} as const satisfies Record<string, AgentToolDefinition>

export type AgentToolName = keyof typeof AGENT_TOOLS
