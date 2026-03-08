import type { FastifyInstance } from 'fastify'
import { buildContext } from './context-builder.js'
import { routeMessage } from './router.agent.js'
import { runStageAgent } from './stage.agent.js'
import { executeToolSafely } from './tool-executor.js'
import { applyGuardrails } from './guardrail.agent.js'
import { consolidateMemories } from './memory.service.js'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import { ZapiService } from '../../services/zapi.service.js'

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

interface PendingConfirmationState {
  contactId: string
  tenantId: string
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>
  agentReply: string
  stageId: string | null
  createdAt: number
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

export async function orchestrate(
  message: string,
  contactId: string,
  tenantId: string,
  fastify: FastifyInstance,
): Promise<OrchestratorResult> {
  const startedAt = Date.now()
  const sync = new FirebaseSyncService(fastify.firebase.firestore)

  try {
    // 1. Build context
    const context = await buildContext(contactId, tenantId, fastify)

    // 2. Set typing indicator
    await setAgentTyping(true, contactId, tenantId, fastify)

    // 3. Route message
    const routing = await routeMessage(message, context)

    // 4. Escalate if needed
    if (routing.shouldEscalate) {
      await executeToolSafely(
        'notify_operator',
        { reason: routing.escalationReason ?? 'Escalação automática', urgency: 'high' },
        context,
        fastify,
      )
      await setAgentTyping(false, contactId, tenantId, fastify)

      return {
        status: 'ESCALATED',
        reply: null,
        intent: routing.intent,
        confidence: routing.confidence,
        durationMs: Date.now() - startedAt,
      }
    }

    // 5. Check trigger match — look for triggers in current stage that match intent
    if (context.stage && routing.confidence > 0.85) {
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
        // Log detected intent on contact
        await fastify.db.contact.update({
          where: { id: contactId },
          data: { lastDetectedIntent: routing.intent, updatedAt: new Date() },
        })

        await setAgentTyping(false, contactId, tenantId, fastify)

        return {
          status: 'TRIGGER_RESOLVED',
          reply: null,
          intent: routing.intent,
          confidence: routing.confidence,
          durationMs: Date.now() - startedAt,
        }
      }
    }

    // 6. Run stage agent with tool execution bound to context
    const stageResult = await runStageAgent(
      message,
      routing,
      context,
      (toolName, input) => executeToolSafely(toolName, input, context, fastify),
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
      }

      await fastify.redis.set(
        pendingConfirmationKey(contactId),
        JSON.stringify(state),
        'EX',
        CONFIRMATION_TTL_SECONDS,
      )

      await setAgentTyping(false, contactId, tenantId, fastify)

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

    // 8. Apply guardrails
    const guardrail = await applyGuardrails(
      stageResult.reply,
      stageResult.toolCalls,
      context,
      fastify,
    )

    const finalReply = guardrail.safeReply ?? stageResult.reply

    // 9. Save agent reply to DB
    const savedMessage = await fastify.db.message.create({
      data: {
        tenantId,
        contactId,
        role: 'AGENT',
        type: 'TEXT',
        content: finalReply,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          guardrailApplied: !guardrail.approved,
        },
      },
    })

    // Update contact last message timestamp
    await fastify.db.contact.update({
      where: { id: contactId },
      data: {
        lastMessageAt: new Date(),
        lastDetectedIntent: routing.intent,
        updatedAt: new Date(),
      },
    })

    // 10. Sync to Firestore
    await sync.syncMessage({
      tenantId,
      contactId,
      messageId: savedMessage.id,
      role: 'AGENT',
      type: 'TEXT',
      content: finalReply,
      createdAt: savedMessage.createdAt,
    })

    await sync.updateContactPresence({
      tenantId,
      contactId,
      status: context.contact.status,
      stageId: context.contact.currentStageId,
      lastMessageAt: new Date(),
    })

    // Send via WhatsApp
    if (context.zapiIntegration?.isActive && context.zapiIntegration.instanceId) {
      const zapi = new ZapiService()
      await zapi.sendText({
        instanceId: context.zapiIntegration.instanceId,
        apiKey: context.zapiIntegration.apiKey,
        phone: context.contact.phone,
        message: finalReply,
      })
    }

    // 11. Turn off typing indicator
    await setAgentTyping(false, contactId, tenantId, fastify)

    const durationMs = Date.now() - startedAt

    // 12. Log to agent_job_logs
    await fastify.db.agentJobLog.create({
      data: {
        tenantId,
        contactId,
        messageId: savedMessage.id,
        routerIntent: routing.intent,
        routerConfidence: routing.confidence,
        stageAgentToolCalls: stageResult.toolCalls.length,
        totalInputTokens: stageResult.inputTokens,
        totalOutputTokens: stageResult.outputTokens,
        durationMs,
      },
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

  // Clear pending state
  await fastify.redis.del(key)

  // Rebuild context for execution
  const context = await buildContext(contactId, tenantId, fastify)

  await setAgentTyping(true, contactId, tenantId, fastify)

  try {
    // Execute pending tools
    for (const tc of state.toolCalls) {
      await executeToolSafely(tc.name, tc.input, context, fastify)
    }

    const confirmationReply = state.agentReply

    // Save confirmation reply
    const savedMessage = await fastify.db.message.create({
      data: {
        tenantId,
        contactId,
        role: 'AGENT',
        type: 'TEXT',
        content: confirmationReply,
        metadata: { confirmedTools: state.toolCalls.map((t) => t.name) },
      },
    })

    await sync.syncMessage({
      tenantId,
      contactId,
      messageId: savedMessage.id,
      role: 'AGENT',
      type: 'TEXT',
      content: confirmationReply,
      createdAt: savedMessage.createdAt,
    })

    // Send via WhatsApp
    if (context.zapiIntegration?.isActive && context.zapiIntegration.instanceId) {
      const zapi = new ZapiService()
      await zapi.sendText({
        instanceId: context.zapiIntegration.instanceId,
        apiKey: context.zapiIntegration.apiKey,
        phone: context.contact.phone,
        message: confirmationReply,
      })
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
