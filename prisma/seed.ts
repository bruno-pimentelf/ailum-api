/**
 * Database seed — creates a complete example clinic for development/testing.
 * Run with: pnpm db:seed
 *
 * Idempotent: checks existence by natural keys (slug, email, name) before creating.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// Load .env manually before any other import (tsx doesn't auto-load .env)
try {
  const envPath = resolve(process.cwd(), '.env')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    value = value.replace(/\s+#.*$/, '')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // rely on existing environment
}

import { PrismaClient } from '../src/generated/prisma/client.js'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL']! })
const adapter = new PrismaPg(pool)
const db = new PrismaClient({ adapter })

async function main() {
  console.log('🌱  Seeding database…')

  // ── 1. Tenant ──────────────────────────────────────────────────────────────
  const tenant = await db.tenant.upsert({
    where: { slug: 'clinica-exemplo' },
    create: {
      clerkOrgId: 'org_seed_example_001',
      name: 'Clínica Exemplo',
      slug: 'clinica-exemplo',
      plan: 'starter',
      agentBasePrompt:
        'Você é da recepção da Clínica Exemplo. Seja gentil, profissional e empática. ' +
        'Fale em português brasileiro. Nunca dê diagnósticos médicos. ' +
        'Seu objetivo é ajudar pacientes a agendarem consultas e responder dúvidas gerais. Apresente-se como pessoa, nunca como assistente virtual ou bot.',
      guardrailRules:
        'Nunca forneça diagnósticos médicos. Nunca prometa resultados terapêuticos. ' +
        'Nunca mencione concorrentes. Sempre encaminhe emergências para o SAMU (192).',
      maxPixAmount: 5000,
      isActive: true,
    },
    update: {},
  })
  console.log(`  ✓ Tenant: ${tenant.name} (${tenant.id})`)

  // ── 2. User (admin) — Better Auth requires an explicit string id ──────────
  const adminUser = await db.user.upsert({
    where: { email: 'admin@clinica-exemplo.com' },
    create: {
      id: randomUUID(),
      name: 'Admin Seed',
      email: 'admin@clinica-exemplo.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    update: {},
  })
  console.log(`  ✓ User: ${adminUser.email} (${adminUser.id})`)

  // ── 3. Tenant member (admin) ───────────────────────────────────────────────
  const existingMember = await db.tenantMember.findFirst({
    where: { tenantId: tenant.id, userId: adminUser.id },
  })
  const adminMember = existingMember ?? await db.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: adminUser.id,
      role: 'ADMIN',
      isActive: true,
      joinedAt: new Date(),
    },
  })
  console.log(`  ✓ Admin member: ${adminMember.id}`)

  // ── 4. Voice ───────────────────────────────────────────────────────────────
  const existingVoice = await db.voice.findFirst({
    where: { tenantId: tenant.id, name: 'Fernanda' },
  })
  const voice = existingVoice ?? await db.voice.create({
    data: {
      tenantId: tenant.id,
      name: 'Fernanda',
      provider: 'ELEVENLABS',
      providerVoiceId: 'EXAVITQu4vr4xnSDxMaL',
      isDefault: true,
    },
  })
  console.log(`  ✓ Voice: ${voice.name} (${voice.id})`)

  // ── 5. Professional ────────────────────────────────────────────────────────
  const existingProfessional = await db.professional.findFirst({
    where: { tenantId: tenant.id, fullName: 'Dra. Ana Souza' },
  })
  const professional = existingProfessional ?? await db.professional.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Dra. Ana Souza',
      specialty: 'Psicologia',
      bio: 'Especialista em saúde mental com 10 anos de experiência clínica.',
      calendarColor: '#3b82f6',
      voiceId: voice.id,
      isActive: true,
    },
  })
  console.log(`  ✓ Professional: ${professional.fullName} (${professional.id})`)

  // ── 6. Professional availability (Mon–Fri, 08:00–18:00) ───────────────────
  const hasAvailability = await db.professionalAvailability.count({
    where: { professionalId: professional.id },
  })
  if (hasAvailability === 0) {
    await db.professionalAvailability.createMany({
      data: [1, 2, 3, 4, 5].map((day) => ({
        professionalId: professional.id,
        dayOfWeek: day,
        startTime: '08:00',
        endTime: '18:00',
        slotDurationMin: 50,
      })),
    })
    console.log('  ✓ Availability: Mon–Fri 08:00–18:00 (50 min slots)')
  } else {
    console.log('  ~ Availability: already set, skipping')
  }

  // ── 7. Services ────────────────────────────────────────────────────────────
  const existingConsulta = await db.service.findFirst({
    where: { tenantId: tenant.id, name: 'Consulta Inicial' },
  })
  const serviceConsulta = existingConsulta ?? await db.service.create({
    data: {
      tenantId: tenant.id,
      name: 'Consulta Inicial',
      description: 'Primeira consulta de avaliação psicológica.',
      durationMin: 50,
      price: 200,
      isActive: true,
    },
  })

  const existingRetorno = await db.service.findFirst({
    where: { tenantId: tenant.id, name: 'Retorno' },
  })
  const serviceRetorno = existingRetorno ?? await db.service.create({
    data: {
      tenantId: tenant.id,
      name: 'Retorno',
      description: 'Consulta de retorno para acompanhamento.',
      durationMin: 50,
      price: 150,
      isActive: true,
    },
  })
  console.log('  ✓ Services: Consulta Inicial (R$200), Retorno (R$150)')

  // Associate services with professional
  for (const serviceId of [serviceConsulta.id, serviceRetorno.id]) {
    await db.professionalService.upsert({
      where: { professionalId_serviceId: { professionalId: professional.id, serviceId } },
      create: { professionalId: professional.id, serviceId },
      update: {},
    })
  }
  console.log('  ✓ Professional services associated')

  // ── 8. Funnel ─────────────────────────────────────────────────────────────
  const existingFunnel = await db.funnel.findFirst({
    where: { tenantId: tenant.id, name: 'Funil Principal' },
  })
  const funnel = existingFunnel ?? await db.funnel.create({
    data: {
      tenantId: tenant.id,
      name: 'Funil Principal',
      description: 'Funil padrão de atendimento para novos pacientes.',
      isActive: true,
      isDefault: true,
      order: 0,
    },
  })
  console.log(`  ✓ Funnel: ${funnel.name} (${funnel.id})`)

  // ── 9. Stages + AgentConfigs ───────────────────────────────────────────────
  const stagesData = [
    {
      name: 'Novo Lead',
      color: '#64748b',
      order: 0,
      isTerminal: false,
      agentName: 'Recepção',
      agentPersonality:
        'Você é da recepção da clínica. Seja calorosa e acolhedora, como secretária falando com paciente. ' +
        'Qualifique o lead e facilite o agendamento. Quando tiver profissional, serviço e horário acordados, use create_appointment.',
      stageContext:
        'Contato inicial. Apresente a clínica, profissionais e serviços. Quando o contato escolher horário e confirmar, chame create_appointment. Use os IDs do contexto (profissionais e serviços).',
      allowedTools: ['search_availability', 'create_appointment', 'move_stage', 'send_message', 'notify_operator'],
    },
    {
      name: 'Qualificado',
      color: '#3b82f6',
      order: 1,
      isTerminal: false,
      agentName: 'Recepção',
      agentPersonality:
        'Você está conversando com alguém interessado em consulta. ' +
        'Seja entusiasmada e facilite o agendamento. Mostre disponibilidade e valor. Quando confirmar, chame create_appointment.',
      stageContext:
        'Lead qualificado. Apresente serviços e agenda. Quando o contato escolher horário e confirmar, chame create_appointment com os IDs do contexto.',
      allowedTools: ['search_availability', 'create_appointment', 'move_stage', 'send_message', 'notify_operator'],
    },
    {
      name: 'Consulta Agendada',
      color: '#10b981',
      order: 2,
      isTerminal: false,
      agentName: 'Recepção',
      agentPersonality:
        'O paciente tem uma consulta agendada. Seja confirmadora e apoiadora. ' +
        'Envie lembretes amigáveis e responda dúvidas sobre a consulta. Pagamento será tratado na clínica.',
      stageContext:
        'Paciente com consulta agendada. Confirme o agendamento, envie endereço da clínica se pedido. Não mencione cobrança via PIX (ainda não integrado).',
      allowedTools: ['move_stage', 'send_message', 'notify_operator'],
    },
    {
      name: 'Atendido',
      color: '#8b5cf6',
      order: 3,
      isTerminal: true,
      agentName: 'Recepção',
      agentPersonality:
        'O paciente foi atendido. Seja grata e encoraje o retorno. ' +
        'Pergunte sobre a experiência e ofereça agendar retorno.',
      stageContext:
        'Paciente que já foi atendido. Agradeça, pergunte como foi a consulta. ' +
        'Ofereça agendamento de retorno se apropriado.',
      allowedTools: ['search_availability', 'create_appointment', 'send_message', 'notify_operator'],
    },
  ]

  const createdStages: { id: string; name: string }[] = []

  for (const s of stagesData) {
    const existing = await db.stage.findFirst({
      where: { funnelId: funnel.id, name: s.name },
    })
    const stage = existing ?? await db.stage.create({
      data: {
        tenantId: tenant.id,
        funnelId: funnel.id,
        name: s.name,
        color: s.color,
        order: s.order,
        isTerminal: s.isTerminal,
      },
    })
    createdStages.push({ id: stage.id, name: stage.name })

    await db.stageAgentConfig.upsert({
      where: { stageId: stage.id },
      create: {
        stageId: stage.id,
        funnelAgentName: s.agentName,
        funnelAgentPersonality: s.agentPersonality,
        stageContext: s.stageContext,
        allowedTools: s.allowedTools,
        model: 'SONNET',
        temperature: 0.4,
      },
      update: {},
    })

    console.log(`  ✓ Stage: ${s.name} (${stage.id})`)
  }

  // ── 10. Triggers ───────────────────────────────────────────────────────────
  const stageByName = Object.fromEntries(createdStages.map((s) => [s.name, s.id]))

  const triggersData = [
    {
      stageName: 'Novo Lead',
      event: 'STAGE_ENTERED' as const,
      action: 'SEND_MESSAGE' as const,
      delayMinutes: 0,
      cooldownSeconds: 86400,
      actionConfig: {
        useAI: false,
        message:
          'Olá, tudo bem? Que bom falar com você. Como posso ajudar hoje?',
      },
    },
    {
      stageName: 'Qualificado',
      event: 'STAGE_ENTERED' as const,
      action: 'SEND_MESSAGE' as const,
      delayMinutes: 0,
      cooldownSeconds: 86400,
      actionConfig: {
        useAI: true,
        template:
          'O paciente {{name}} demonstrou interesse em agendar. ' +
          'Apresente os serviços disponíveis (Consulta Inicial R$200, Retorno R$150) ' +
          'e ofereça ver horários disponíveis com a Dra. Ana Souza.',
      },
    },
    {
      stageName: 'Novo Lead',
      event: 'STALE_IN_STAGE' as const,
      action: 'SEND_MESSAGE' as const,
      delayMinutes: 60,
      cooldownSeconds: 43200,
      actionConfig: {
        useAI: false,
        message:
          'Oi, notei que você entrou em contato conosco. Posso te ajudar com alguma informação sobre a clínica ou agendamento?',
      },
    },
    {
      stageName: 'Consulta Agendada',
      event: 'PAYMENT_CONFIRMED' as const,
      action: 'SEND_MESSAGE' as const,
      delayMinutes: 0,
      cooldownSeconds: 86400,
      actionConfig: {
        useAI: false,
        message:
          'Pagamento confirmado. Sua consulta está garantida.\n' +
          'Aguardamos você na data e horário combinados. Qualquer dúvida, estou aqui!',
      },
    },
  ]

  for (const t of triggersData) {
    const stageId = stageByName[t.stageName]
    if (!stageId) continue

    const existing = await db.trigger.findFirst({
      where: { stageId, tenantId: tenant.id, event: t.event, action: t.action },
    })
    if (!existing) {
      await db.trigger.create({
        data: {
          tenantId: tenant.id,
          stageId,
          event: t.event,
          action: t.action,
          actionConfig: t.actionConfig as never,
          delayMinutes: t.delayMinutes,
          cooldownSeconds: t.cooldownSeconds,
          isActive: true,
        },
      })
    }
    console.log(`  ✓ Trigger: [${t.event}] → ${t.action} (stage: ${t.stageName})`)
  }

  console.log('\n✅  Seed completed successfully!')
  console.log(`   Tenant ID:      ${tenant.id}`)
  console.log(`   Admin User ID:  ${adminUser.id}`)
  console.log(`   Funnel ID:      ${funnel.id}`)
  console.log('\n   Login: admin@clinica-exemplo.com (define a senha pelo /auth/sign-up/email)')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
    await pool.end()
  })
