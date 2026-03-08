import type { MemberRole } from '../generated/prisma/client.js'

/**
 * Context object attached to every authenticated request.
 * Built by the authenticate decorator and passed down to services.
 */
export interface RequestContext {
  userId: string
  tenantId: string
  role: MemberRole
  memberId: string
  professionalId: string | null
}

/**
 * Context available inside a job worker.
 */
export interface JobContext {
  tenantId: string
  contactId: string
  triggerId?: string
  appointmentId?: string
  chargeId?: string
  messageId?: string
}

// ─── Agent Context types ──────────────────────────────────────────────────────

export interface AvailableSlot {
  time: string
  endTime: string
}

export interface AvailableProfessional {
  id: string
  fullName: string
  specialty: string | null
  slots: AvailableSlot[]
}

export interface ContextMessage {
  id: string
  role: string
  content: string
  type: string
  createdAt: Date
}

export interface ContextStageAgentConfig {
  funnelAgentName: string
  funnelAgentPersonality: string | null
  stageContext: string | null
  allowedTools: string[]
  model: string
  temperature: number
}

export interface ContextStage {
  id: string
  name: string
  funnelId: string
  order: number
  isTerminal: boolean
  agentConfig: ContextStageAgentConfig | null
}

export interface ContextFunnel {
  id: string
  name: string
  description: string | null
}

export interface ContextContact {
  id: string
  phone: string
  name: string | null
  email: string | null
  status: string
  currentFunnelId: string | null
  currentStageId: string | null
  zapiSessionId: string | null
  lastDetectedIntent: string | null
  assignedProfessionalId: string | null
  stageEnteredAt: Date | null
  metadata: unknown
}

export interface ContextMemory {
  key: string
  value: string
  confidence: number
}

export interface ContextAppointment {
  id: string
  scheduledAt: Date
  durationMin: number
  status: string
  professional: { fullName: string; specialty: string | null }
  service: { name: string; price: unknown }
}

export interface ContextCharge {
  id: string
  amount: unknown
  description: string
  status: string
  pixCopyPaste: string | null
  dueAt: Date | null
}

export interface ContextTenant {
  id: string
  name: string
  agentBasePrompt: string | null
  guardrailRules: string | null
  maxPixAmount: unknown
}

export interface ContextAsaasIntegration {
  instanceId: string | null
  apiKey: string
  isActive: boolean
}

export interface ContextZapiIntegration {
  instanceId: string | null
  apiKey: string
  isActive: boolean
}

/**
 * Full agent context built by context-builder for every agent invocation.
 */
export interface AgentContext {
  contact: ContextContact
  tenant: ContextTenant
  stage: ContextStage | null
  funnel: ContextFunnel | null
  messages: ContextMessage[]
  nextAppointment: ContextAppointment | null
  pendingCharge: ContextCharge | null
  availableProfessionals: AvailableProfessional[]
  memories: ContextMemory[]
  asaasIntegration: ContextAsaasIntegration | null
  zapiIntegration: ContextZapiIntegration | null
}
