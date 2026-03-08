import type { ContactStatus } from '../generated/prisma/client.js'

/**
 * Maps a tool name or webhook event to the resulting ContactStatus.
 * The agent and trigger engine use this to automatically advance
 * a contact's status after executing an action.
 */
export const STATUS_TRANSITIONS: Record<string, ContactStatus> = {
  // Agent tools
  create_appointment: 'APPOINTMENT_SCHEDULED',
  generate_pix: 'AWAITING_PAYMENT',
  notify_operator: 'IN_HUMAN_SERVICE',
  qualify_lead: 'QUALIFIED',
  mark_no_interest: 'NO_INTEREST',
  mark_attended: 'ATTENDED',
  mark_recurring: 'RECURRING',

  // Webhook events
  payment_confirmed_webhook: 'PAYMENT_CONFIRMED',
  appointment_completed_webhook: 'ATTENDED',
  appointment_cancelled_webhook: 'QUALIFIED',

  // Trigger actions
  move_to_human_service: 'IN_HUMAN_SERVICE',
  payment_overdue: 'AWAITING_PAYMENT',
}

/**
 * Terminal statuses — contacts in these stages do not receive
 * automated messages unless explicitly re-entered into a funnel.
 */
export const TERMINAL_STATUSES: ContactStatus[] = [
  'NO_INTEREST',
  'ATTENDED',
  'RECURRING',
]
