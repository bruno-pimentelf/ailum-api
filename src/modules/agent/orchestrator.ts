import type { FastifyInstance } from 'fastify'
import { buildContext } from './context-builder.js'
import { routeMessage } from './router.agent.js'
import { runStageAgent } from './stage.agent.js'
import { executeToolSafely } from './tool-executor.js'
import { applyGuardrails } from './guardrail.agent.js'
import { consolidateMemories } from './memory.service.js'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import { ZapiService } from '../../services/zapi.service.js'
import {
  splitIntoChunks,
  computeDelayBeforeReply,
  computeDelayBetweenChunks,
  sleep,
} from './humanize-message.js'

// ─── Result types ─────────────────────────────────────────────────────────────

export type OrchestratorStatus =
  | 'REPLIED'
  | 'ESCALATED'
  | 'TRIGGER_RESOLVED'
  | 'CONFIRMATION_REQUIRED'
  | 'ERROR'

export interface OrchestratorResult {
  status: OrchestratorStatus
  reply: string | null
  jobId?: string
  confirmationSummary?: string
  intent?: string
  confidence?: number
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
}

// Redis key for pending confirmation state
const pendingConfirmationKey = (contactId: string) => `pending_confirmation:${contactId}`
const CONFIRMATION_TTL_SECONDS = 600

type AuditEntry = { label: string; detail: string; data?: Record<string, unknown> }

interface PendingConfirmationState {
  contactId: string
  tenantId: string
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>
  agentReply: string
  stageId: string | null
  createdAt: number
  testMode?: boolean
}

// ─── setAgentTyping ───────────────────────────────────────────────────────────

async function setAgentTyping(
  typing: boolean,
  contactId: string,
  tenantId: string,
  fastify: FastifyInstance,
) {
  try {
    if (fastify.firebase.firestore) {
      await fastify.firebase.firestore
        .collection('tenants')
        .doc(tenantId)
        .collection('contacts')
        .doc(contactId)
        .set({ agentTyping: typing, updatedAt: new Date() }, { merge: true })
    }
  } catch (err) {
    fastify.log.warn({ err }, 'orchestrator:setAgentTyping:error')
  }
}

// ─── orchestrate ─────────────────────────────────────────────────────────────

export interface OrchestrateOptions {
  testMode?: boolean
}

export async function orchestrate(
  message: string,
  contactId: string,
  tenantId: string,
  fastify: FastifyInstance,
  options?: OrchestrateOptions,
): Promise<OrchestratorResult> {
  const testMode = options?.testMode ?? false
  const startedAt = Date.now()
  const sync = new FirebaseSyncService(fastify.firebase.firestore)
  const audit: AuditEntry[] = []

  const writeAudit = async (
    status: string,
    messageId?: string | null,
    extras?: { routerIntent?: string; routerConfidence?: number; stageAgentToolCalls?: number; totalInputTokens?: number; totalOutputTokens?: number; error?: string },
  ) => {
    await fastify.db.agentJobLog.create({
      data: {
        tenantId,
        contactId,
        status,
        messageId: messageId ?? null,
        routerIntent: extras?.routerIntent ?? null,
        routerConfidence: extras?.routerConfidence ?? null,
        stageAgentToolCalls: extras?.stageAgentToolCalls ?? 0,
        totalInputTokens: extras?.totalInputTokens ?? 0,
        totalOutputTokens: extras?.totalOutputTokens ?? 0,
        durationMs: Date.now() - startedAt,
        error: extras?.error ?? null,
        auditDetails: audit,
      },
    })
  }

  try {
    // 1. Build context
    const context = await buildContext(contactId, tenantId, fastify)

    // 2. Set typing indicator
    await setAgentTyping(true, contactId, tenantId, fastify)

    // 3. Route message
    const routing = await routeMessage(message, context)
    audit.push({
      label: 'Router',
      detail: `Intent: ${routing.intent} (${Math.round((routing.confidence ?? 0) * 100)}% confiança)`,
      data: {
        intent: routing.intent,
        confidence: routing.confidence,
        stage: context.stage?.name ?? null,
        funnel: context.funnel?.name ?? null,
      },
    })

    // 4. Escalate if needed
    if (routing.shouldEscalate) {
      audit.push({
        label: 'Escalação',
        detail: `Necessária — ${routing.escalationReason ?? 'confiança baixa ou crise'}`,
        data: { reason: routing.escalationReason },
      })
      await executeToolSafely(
        'notify_operator',
        { reason: routing.escalationReason ?? 'Escalação automática', urgency: 'high' },
        context,
        fastify,
      )
      await setAgentTyping(false, contactId, tenantId, fastify)
      await writeAudit('ESCALATED', null, {
        routerIntent: routing.intent,
        routerConfidence: routing.confidence ?? undefined,
      })
      return {
        status: 'ESCALATED',
        reply: null,
        intent: routing.intent,
        confidence: routing.confidence,
        durationMs: Date.now() - startedAt,
      }
    }

    audit.push({ label: 'Escalação', detail: 'Não necessária' })

    // 5. Check trigger match — look for triggers in current stage that match intent (threshold 0.75)
    if (context.stage && routing.confidence > 0.75) {
      const matchingTrigger = await fastify.db.trigger.findFirst({
        where: {
          stageId: context.stage.id,
          tenantId,
          isActive: true,
          event: 'AI_INTENT',
          conditionConfig: { path: ['intent'], equals: routing.intent },
        },
      })

      if (matchingTrigger) {
        audit.push({
          label: 'Trigger',
          detail: `Acionado — intent ${routing.intent} correspondeu ao trigger do stage`,
          data: { intent: routing.intent },
        })
        await fastify.db.contact.update({
          where: { id: contactId },
          data: { lastDetectedIntent: routing.intent, updatedAt: new Date() },
        })

        await setAgentTyping(false, contactId, tenantId, fastify)
        await writeAudit('TRIGGER_RESOLVED', null, {
          routerIntent: routing.intent,
          routerConfidence: routing.confidence ?? undefined,
        })
        return {
          status: 'TRIGGER_RESOLVED',
          reply: null,
          intent: routing.intent,
          confidence: routing.confidence,
          durationMs: Date.now() - startedAt,
        }
      }
    }

    audit.push({ label: 'Trigger', detail: 'Nenhum acionado' })

    // 6. Run stage agent with tool execution bound to context
    const stageResult = await runStageAgent(
      message,
      routing,
      context,
      (toolName, input) =>
        executeToolSafely(toolName, input, context, fastify, { testMode }),
    )

    // 7. Confirmation required — save state in Redis
    if (stageResult.requiresConfirmation) {
      const state: PendingConfirmationState = {
        contactId,
        tenantId,
        toolCalls: stageResult.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
        agentReply: stageResult.reply,
        stageId: context.stage?.id ?? null,
        createdAt: Date.now(),
        testMode,
      }

      await fastify.redis.set(
        pendingConfirmationKey(contactId),
        JSON.stringify(state),
        'EX',
        CONFIRMATION_TTL_SECONDS,
      )

      audit.push({
        label: 'Stage Agent',
        detail: `${stageResult.toolCalls.length} tool(s) — confirmação pendente: ${stageResult.toolCalls.map((t) => t.name).join(', ')}`,
        data: {
          tools: stageResult.toolCalls.map((t) => t.name),
          toolExecutions: stageResult.toolCalls.map((t) => ({
            tool: t.name,
            input: summarizeToolInput(t.name, t.input),
            success: t.result.success,
            reason: t.result.reason,
            summary: summarizeToolResult(t.name, t.result),
          })),
          inputTokens: stageResult.inputTokens,
          outputTokens: stageResult.outputTokens,
        },
      })
      audit.push({ label: 'Resultado', detail: 'Aguardando confirmação do usuário' })

      await setAgentTyping(false, contactId, tenantId, fastify)
      await writeAudit('CONFIRMATION_REQUIRED', null, {
        routerIntent: routing.intent,
        routerConfidence: routing.confidence ?? undefined,
        stageAgentToolCalls: stageResult.toolCalls.length,
        totalInputTokens: stageResult.inputTokens,
        totalOutputTokens: stageResult.outputTokens,
      })
      return {
        status: 'CONFIRMATION_REQUIRED',
        reply: stageResult.reply,
        confirmationSummary: buildConfirmationSummary(stageResult.toolCalls),
        intent: routing.intent,
        confidence: routing.confidence,
        inputTokens: stageResult.inputTokens,
        outputTokens: stageResult.outputTokens,
        durationMs: Date.now() - startedAt,
      }
    }

    audit.push({
      label: 'Stage Agent',
      detail: stageResult.toolCalls.length > 0
        ? `${stageResult.toolCalls.length} tool(s) executada(s): ${stageResult.toolCalls.map((t) => `${t.name}${t.result.success ? ' ✓' : ' ✗'}`).join(', ')}`
        : 'Nenhuma tool chamada',
      data: {
        tools: stageResult.toolCalls.map((t) => t.name),
        toolExecutions: stageResult.toolCalls.map((t) => ({
          tool: t.name,
          input: summarizeToolInput(t.name, t.input),
          success: t.result.success,
          reason: t.result.reason,
          summary: summarizeToolResult(t.name, t.result),
        })),
        inputTokens: stageResult.inputTokens,
        outputTokens: stageResult.outputTokens,
      },
    })

    const createAppointmentSuccess = stageResult.toolCalls.find(
      (t) => t.name === 'create_appointment' && t.result.success && t.result.data,
    )
    if (createAppointmentSuccess?.result.data) {
      const d = createAppointmentSuccess.result.data as {
        scheduledAtFormatted?: string
        professionalName?: string | null
        serviceName?: string | null
        durationMin?: number
        appointmentId?: string
        scheduledAt?: string
      }
      const detailLine = d.scheduledAtFormatted
        ? `${d.scheduledAtFormatted} — ${d.professionalName ?? '?'}, ${d.serviceName ?? '?'}${d.durationMin ? ` (${d.durationMin} min)` : ''}`
        : 'Consulta agendada com sucesso'
      audit.push({
        label: 'Consulta agendada',
        detail: detailLine,
        data: {
          appointmentId: d.appointmentId,
          scheduledAt: d.scheduledAt,
          professionalName: d.professionalName,
          serviceName: d.serviceName,
          durationMin: d.durationMin,
        },
      })
    }

    // 8. Apply guardrails
    const guardrail = await applyGuardrails(
      stageResult.reply,
      stageResult.toolCalls,
      context,
      fastify,
    )

    const finalReply = guardrail.safeReply ?? stageResult.reply

    audit.push({
      label: 'Guardrails',
      detail: guardrail.approved ? 'Aprovado' : 'Ajustado ou bloqueado',
      data: guardrail.approved ? undefined : { violation: guardrail.violation },
    })

    const deliveryNote = testMode
      ? 'Resposta salva (modo teste — não enviada no WhatsApp)'
      : 'Resposta enviada no WhatsApp'
    audit.push({ label: 'Resultado', detail: deliveryNote })

    // 9. Humanização: dividir resposta em partes e enviar com delay (simula digitação humana)
    const chunks = splitIntoChunks(finalReply)
    const initialDelayMs = computeDelayBeforeReply(
      message.trim().split(/\s+/).filter(Boolean).length,
    )
    await sleep(initialDelayMs)

    let firstMessageId: string | null = null
    const zapi =
      !testMode && context.zapiIntegration?.isActive && context.zapiIntegration.instanceId
        ? new ZapiService()
        : null

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const savedMessage = await fastify.db.message.create({
        data: {
          tenantId,
          contactId,
          role: 'AGENT',
          type: 'TEXT',
          content: chunk,
          metadata: {
            intent: routing.intent,
            confidence: routing.confidence,
            guardrailApplied: !guardrail.approved,
            chunkIndex: i,
            totalChunks: chunks.length,
          },
        },
      })
      if (!firstMessageId) firstMessageId = savedMessage.id

      await sync.syncMessage({
        tenantId,
        contactId,
        messageId: savedMessage.id,
        role: 'AGENT',
        type: 'TEXT',
        content: chunk,
        createdAt: savedMessage.createdAt,
      })

      if (zapi && context.zapiIntegration) {
        await zapi.sendText({
          instanceId: context.zapiIntegration.instanceId!,
          apiKey: context.zapiIntegration.apiKey,
          phone: context.contact.phone,
          message: chunk,
        })
      }

      if (i < chunks.length - 1) {
        const wordCount = chunk.trim().split(/\s+/).filter(Boolean).length
        await sleep(computeDelayBetweenChunks(wordCount))
      }
    }

    await fastify.db.contact.update({
      where: { id: contactId },
      data: {
        lastMessageAt: new Date(),
        lastDetectedIntent: routing.intent,
        updatedAt: new Date(),
      },
    })

    await sync.updateContactPresence({
      tenantId,
      contactId,
      status: context.contact.status,
      stageId: context.contact.currentStageId,
      lastMessageAt: new Date(),
    })

    // 10. Turn off typing indicator
    await setAgentTyping(false, contactId, tenantId, fastify)

    const durationMs = Date.now() - startedAt

    // 12. Log to agent_job_logs
    await writeAudit('REPLIED', firstMessageId ?? null, {
      routerIntent: routing.intent,
      routerConfidence: routing.confidence ?? undefined,
      stageAgentToolCalls: stageResult.toolCalls.length,
      totalInputTokens: stageResult.inputTokens,
      totalOutputTokens: stageResult.outputTokens,
    })

    // 13. Fire-and-forget memory consolidation
    consolidateMemories(contactId, tenantId, context.messages, fastify).catch((err) =>
      fastify.log.error({ err }, 'memory:consolidate:background_error'),
    )

    return {
      status: 'REPLIED',
      reply: finalReply,
      intent: routing.intent,
      confidence: routing.confidence,
      inputTokens: stageResult.inputTokens,
      outputTokens: stageResult.outputTokens,
      durationMs,
    }
  } catch (err) {
    await setAgentTyping(false, contactId, tenantId, fastify).catch(() => {})
    fastify.log.error({ err, contactId, tenantId }, 'orchestrator:error')

    audit.push({
      label: 'Erro',
      detail: err instanceof Error ? err.message : String(err),
      data: { error: String(err) },
    })
    await fastify.db.agentJobLog.create({
      data: {
        tenantId,
        contactId,
        status: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        auditDetails: audit,
      },
    })

    return {
      status: 'ERROR',
      reply: null,
      durationMs: Date.now() - startedAt,
    }
  }
}

// ─── confirmAndExecute ────────────────────────────────────────────────────────

export async function confirmAndExecute(
  contactId: string,
  tenantId: string,
  fastify: FastifyInstance,
): Promise<OrchestratorResult> {
  const startedAt = Date.now()
  const key = pendingConfirmationKey(contactId)

  const stateRaw = await fastify.redis.get(key)
  if (!stateRaw) {
    return {
      status: 'ERROR',
      reply: 'Solicitação expirada. Por favor, inicie novamente.',
      durationMs: Date.now() - startedAt,
    }
  }

  const state = JSON.parse(stateRaw) as PendingConfirmationState
  const sync = new FirebaseSyncService(fastify.firebase.firestore)
  const confirmTestMode = state.testMode ?? false

  // Clear pending state
  await fastify.redis.del(key)

  // Rebuild context for execution
  const context = await buildContext(contactId, tenantId, fastify)

  await setAgentTyping(true, contactId, tenantId, fastify)

  try {
    // Execute pending tools
    for (const tc of state.toolCalls) {
      await executeToolSafely(tc.name, tc.input, context, fastify, {
        testMode: confirmTestMode,
      })
    }

    const confirmationReply = state.agentReply

    const chunks = splitIntoChunks(confirmationReply)
    await sleep(computeDelayBeforeReply(5))

    const zapi =
      !confirmTestMode &&
      context.zapiIntegration?.isActive &&
      context.zapiIntegration.instanceId
        ? new ZapiService()
        : null

    let firstMessageId: string | null = null
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const savedMessage = await fastify.db.message.create({
        data: {
          tenantId,
          contactId,
          role: 'AGENT',
          type: 'TEXT',
          content: chunk,
          metadata: {
            confirmedTools: state.toolCalls.map((t) => t.name),
            chunkIndex: i,
            totalChunks: chunks.length,
          },
        },
      })
      if (!firstMessageId) firstMessageId = savedMessage.id

      await sync.syncMessage({
        tenantId,
        contactId,
        messageId: savedMessage.id,
        role: 'AGENT',
        type: 'TEXT',
        content: chunk,
        createdAt: savedMessage.createdAt,
      })

      if (zapi && context.zapiIntegration) {
        await zapi.sendText({
          instanceId: context.zapiIntegration.instanceId!,
          apiKey: context.zapiIntegration.apiKey,
          phone: context.contact.phone,
          message: chunk,
        })
      }

      if (i < chunks.length - 1) {
        const wordCount = chunk.trim().split(/\s+/).filter(Boolean).length
        await sleep(computeDelayBetweenChunks(wordCount))
      }
    }

    await setAgentTyping(false, contactId, tenantId, fastify)

    return {
      status: 'REPLIED',
      reply: confirmationReply,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    await setAgentTyping(false, contactId, tenantId, fastify).catch(() => {})
    fastify.log.error({ err, contactId }, 'orchestrator:confirmAndExecute:error')

    return {
      status: 'ERROR',
      reply: null,
      durationMs: Date.now() - startedAt,
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function summarizeToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case 'search_availability':
      return { date: input.date }
    case 'create_appointment':
      return {
        professional_id: String(input.professional_id ?? '').slice(0, 8) + '...',
        service_id: String(input.service_id ?? '').slice(0, 8) + '...',
        scheduled_at: input.scheduled_at,
      }
    case 'generate_pix':
      return { amount: input.amount, description: input.description }
    case 'move_stage':
      return { stage_id: String(input.stage_id ?? '').slice(0, 8) + '...', reason: input.reason }
    case 'notify_operator':
      return { reason: input.reason, urgency: input.urgency }
    default:
      return input
  }
}

function summarizeToolResult(
  tool: string,
  result: { success: boolean; reason?: string; data?: Record<string, unknown> },
): string | null {
  if (!result.success) return result.reason ?? 'Falhou'
  const d = result.data
  switch (tool) {
    case 'search_availability': {
      const profs = (d?.professionals as unknown[])?.length ?? 0
      const profsArr = (d?.professionals as { slots?: unknown[] }[]) ?? []
      const slots = profsArr.reduce((acc, p) => acc + (p.slots?.length ?? 0), 0)
      return `${profs} profissional(is), ${slots} slot(s) em ${d?.date ?? '?'}`
    }
    case 'create_appointment': {
      const formatted = d?.scheduledAtFormatted as string | undefined
      const prof = d?.professionalName as string | undefined
      const svc = d?.serviceName as string | undefined
      if (formatted && (prof || svc))
        return `Agendado: ${formatted} — ${prof ?? '?'}, ${svc ?? '?'}`
      return `Agendado para ${d?.scheduledAt ?? '?'}`
    }
    case 'generate_pix':
      return `PIX R$ ${d?.amount ?? '?'}`
    case 'move_stage':
      return `Stage alterado`
    case 'notify_operator':
      return 'Operador notificado'
    default:
      return result.reason ?? null
  }
}

function buildConfirmationSummary(
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: { data?: Record<string, unknown> } }>,
): string {
  return toolCalls
    .map((tc) => {
      switch (tc.name) {
        case 'create_appointment': {
          const d = tc.result.data
          return `Agendamento em ${d?.scheduledAt ?? '?'}`
        }
        case 'generate_pix': {
          const d = tc.result.data
          return `Cobrança PIX de R$ ${d?.amount ?? '?'}`
        }
        default:
          return tc.name
      }
    })
    .join(' + ')
}
