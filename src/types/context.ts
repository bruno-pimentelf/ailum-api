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

export interface AvailableProfessionalService {
  id: string
  name: string
  durationMin: number
  price: number
}

export interface AvailableProfessional {
  id: string
  fullName: string
  specialty: string | null
  services: AvailableProfessionalService[]
  slots: AvailableSlot[]
}

export interface ContextService {
  id: string
  name: string
  durationMin: number
  price: unknown
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

export interface ContextFunnelStage {
  id: string
  name: string
  order: number
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
  /** Data atual no servidor (DD/MM/YYYY) para o agente saber "hoje" ao construir scheduled_at */
  currentDate: string
  /** Horário atual (HH:mm) — para saber se ainda há slots hoje ou se deve oferecer amanhã */
  currentTime: string
  /** Exemplo de scheduled_at ISO para hoje às 09:00 (timezone -03:00) — usar como base para create_appointment */
  currentDateIsoExample: string
  /** Amanhã em YYYY-MM-DD para search_availability (ex: 2026-03-10) */
  tomorrowDateIso: string
  /** Depois de amanhã em YYYY-MM-DD para search_availability */
  dayAfterTomorrowDateIso: string
  contact: ContextContact
  tenant: ContextTenant
  stage: ContextStage | null
  funnel: ContextFunnel | null
  funnelStages: ContextFunnelStage[]
  messages: ContextMessage[]
  /** Próxima consulta (a mais próxima no tempo) — mantido para compatibilidade */
  nextAppointment: ContextAppointment | null
  /** Próximas consultas (PENDING ou CONFIRMED) — para o agente listar quando o paciente perguntar */
  upcomingAppointments: ContextAppointment[]
  pendingCharge: ContextCharge | null
  availableProfessionals: AvailableProfessional[]
  availableServices: ContextService[]
  memories: ContextMemory[]
  asaasIntegration: ContextAsaasIntegration | null
  zapiIntegration: ContextZapiIntegration | null
}
