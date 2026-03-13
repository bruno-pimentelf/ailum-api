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
    description: `Busca horários disponíveis para uma data. Chamar quando: (1) o usuário indicar um dia (ex: "amanhã", "terça", "10/03"); (2) o usuário perguntar sem especificar data — "quais você tem?", "quais dias tem?", "o que tem disponível?" — use amanhã primeiro; se 0 profissionais, tente depois de amanhã.
Retorna profissionais com id, nome, serviços (id, nome, duração, preço) e slots (time, endTime). Apresente de forma completa: data, profissional e lista de horários.
Quando retorna 0 profissionais, o resultado inclui "diagnostic" com detalhes. NUNCA diga que não há horários sem ter chamado a tool.`,
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
      'Gera cobrança PIX para o contato via Asaas. Fluxo PIX-antes: use professional_id, service_id, scheduled_at — a consulta será criada apenas após pagamento. Fluxo normal: use appointment_id após create_appointment.',
    input_schema: Type.Object({
      amount: Type.Number({
        minimum: 1,
        description: 'Valor da cobrança em BRL (ex: 150.00). Use o price do serviço em professional.services ou availableServices.',
      }),
      description: Type.String({ description: 'Descrição da cobrança exibida ao paciente' }),
      appointment_id: Type.Optional(
        Type.String({ format: 'uuid', description: 'UUID da consulta já criada (fluxo normal)' }),
      ),
      professional_id: Type.Optional(
        Type.String({ format: 'uuid', description: 'UUID do profissional — obrigatório no fluxo PIX-antes' }),
      ),
      service_id: Type.Optional(
        Type.String({ format: 'uuid', description: 'UUID do serviço — obrigatório no fluxo PIX-antes' }),
      ),
      scheduled_at: Type.Optional(
        Type.String({ format: 'date-time', description: 'Data/hora ISO 8601 (ex: 2026-03-16T13:00:00-03:00) — obrigatório no fluxo PIX-antes' }),
      ),
      due_hours: Type.Optional(
        Type.Number({
          minimum: 1,
          default: 24,
          description: 'Horas até o PIX expirar',
        }),
      ),
      cpf: Type.Optional(
        Type.String({
          description:
            'CPF do paciente (11 dígitos, com ou sem pontuação). OBRIGATÓRIO para gerar cobrança no Asaas. Peça ao paciente antes de chamar generate_pix.',
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

  cancel_appointment: {
    name: 'cancel_appointment',
    description: `Cancela uma consulta agendada do contato. Use quando o paciente pedir explicitamente para cancelar.
Só cancela appointments PENDING ou CONFIRMED do contato. Use appointment_id de upcomingAppointments.`,
    input_schema: Type.Object({
      appointment_id: Type.String({
        format: 'uuid',
        description: 'UUID da consulta a cancelar (do contato)',
      }),
      reason: Type.Optional(Type.String({ description: 'Motivo informado pelo paciente' })),
    }),
  },

  reschedule_appointment: {
    name: 'reschedule_appointment',
    description: `Remarca uma consulta para nova data/horário. Use quando o paciente pedir para mudar o horário.
Precisa do appointment_id e do novo scheduled_at. Chame search_availability para ver horários livres antes de remarcar.`,
    input_schema: Type.Object({
      appointment_id: Type.String({
        format: 'uuid',
        description: 'UUID da consulta a remarcar',
      }),
      scheduled_at: Type.String({
        format: 'date-time',
        description: 'Novo horário ISO 8601 com -03:00 (ex: 2026-03-12T14:00:00-03:00)',
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
