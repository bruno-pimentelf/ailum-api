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
    description:
      'Search available appointment slots for a specific date. Call when the user mentions a date (e.g. "amanhã", "terça", "10/03"). Returns professionals with their IDs, services with IDs, and available time slots. Use the returned IDs for create_appointment.',
    input_schema: Type.Object({
      date: Type.String({
        description: 'Date in YYYY-MM-DD format (e.g. 2026-03-10 for March 10, 2026)',
      }),
    }),
  },

  create_appointment: {
    name: 'create_appointment',
    description:
      'Schedule an appointment for the contact with a specific professional and service. Use when the contact agrees on a date and time.',
    input_schema: Type.Object({
      professional_id: Type.String({ format: 'uuid', description: 'UUID of the professional' }),
      service_id: Type.String({ format: 'uuid', description: 'UUID of the service' }),
      scheduled_at: Type.String({
        format: 'date-time',
        description: 'ISO 8601 datetime for the appointment (e.g. 2025-03-15T14:00:00-03:00)',
      }),
      notes: Type.Optional(Type.String({ description: 'Additional notes for the appointment' })),
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
