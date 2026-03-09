#!/usr/bin/env tsx
/**
 * Testa a configuração do agente: stages, agentConfig, allowedTools.
 * Uso (rode com --env-file para carregar variáveis):
 *   pnpm test:agent                    # diagnóstico
 *   pnpm test:agent -- --fix           # cria agentConfig em stages sem config
 *   pnpm test:agent -- --message "Oi"  # enfileira mensagem de teste (server rodando)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client.js'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const envPath = resolve(process.cwd(), '.env.production.local')
try {
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    value = value.replace(/\s+#.*$/, '')
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  console.error('Carregue .env.production.local ou defina DATABASE_URL')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! })
const adapter = new PrismaPg(pool)
const db = new PrismaClient({ adapter })

const DEFAULT_AGENT_CONFIG = {
  funnelAgentName: 'Ailum',
  funnelAgentPersonality:
    'Você é Ailum, assistente virtual da clínica. Seja calorosa e acolhedora. Qualifique o lead e facilite o agendamento. Quando tiver profissional, serviço e horário acordados, use create_appointment.',
  stageContext:
    'Contato inicial. Apresente a clínica, profissionais e serviços. Quando o contato escolher horário e confirmar, chame create_appointment. Use os IDs do contexto (profissionais e serviços).',
  allowedTools: ['search_availability', 'create_appointment', 'move_stage', 'send_message', 'notify_operator'],
  model: 'SONNET' as const,
  temperature: 0.4,
}

async function main() {
  const args = process.argv.slice(2)
  const doFix = args.includes('--fix')
  const msgIdx = args.indexOf('--message')
  const testMessage = msgIdx >= 0 ? args[msgIdx + 1] ?? 'Oi' : null

  console.log('=== Diagnóstico: Stages e Agent Config ===\n')

  const funnels = await db.funnel.findMany({
    where: { isActive: true },
    orderBy: { order: 'asc' },
    include: {
      stages: {
        orderBy: { order: 'asc' },
        include: { agentConfig: true },
      },
    },
  })

  if (funnels.length === 0) {
    console.log('Nenhum funil ativo. Crie um funil (POST /v1/funnels/default) e rode de novo.')
    process.exit(1)
  }

  let stagesWithoutConfig = 0

  for (const funnel of funnels) {
    console.log(`Funil: ${funnel.name} (${funnel.id})`)
    for (const stage of funnel.stages) {
      const cfg = stage.agentConfig
      const hasConfig = !!cfg
      if (!hasConfig) stagesWithoutConfig++

      const tools = cfg?.allowedTools ?? []
      const hasCreate = tools.includes('create_appointment')

      console.log(
        `  - ${stage.name} (${stage.id}) | agentConfig: ${hasConfig ? 'SIM' : 'NÃO'} | allowedTools: ${tools.length ? tools.join(', ') : '—'} | create_appointment: ${hasCreate ? 'SIM' : 'NÃO'}`,
      )
    }
    console.log('')
  }

  // Playground contact
  const playground = await db.contact.findFirst({
    where: { phone: '__playground__', isActive: true },
    include: {
      currentStage: { include: { agentConfig: true } },
      currentFunnel: true,
    },
  })

  if (playground) {
    const stage = playground.currentStage
    const cfg = stage?.agentConfig
    console.log('Contato Playground:')
    console.log(`  ID: ${playground.id}`)
    console.log(`  Stage atual: ${stage?.name ?? '—'} (${stage?.id ?? '—'})`)
    console.log(`  agentConfig: ${cfg ? 'SIM' : 'NÃO'}`)
    console.log(`  allowedTools: ${cfg?.allowedTools?.join(', ') ?? '—'}`)
    if (!cfg || !cfg.allowedTools?.includes('create_appointment')) {
      console.log('\n  ⚠️  O stage do playground NÃO tem create_appointment. O agente não conseguirá agendar.')
    }
    console.log('')
  }

  // Fix: create agentConfig for stages without it
  if (doFix && stagesWithoutConfig > 0) {
    console.log(`--- Criando agentConfig em ${stagesWithoutConfig} stage(s) ---\n`)

    for (const funnel of funnels) {
      for (const stage of funnel.stages) {
        if (stage.agentConfig) continue

        await db.stageAgentConfig.create({
          data: {
            stageId: stage.id,
            ...DEFAULT_AGENT_CONFIG,
          },
        })
        console.log(`  ✓ ${funnel.name} > ${stage.name}: agentConfig criado`)
      }
    }
    console.log('\nConcluído. Execute o script de novo para verificar.\n')
  } else if (doFix) {
    console.log('Todos os stages já têm agentConfig. Nada a fazer.\n')
  }

  // Enqueue test message
  if (testMessage && playground) {
    const { agentQueue } = await import('../src/jobs/queues.js')
    const job = await agentQueue.add(
      'test',
      {
        tenantId: playground.tenantId,
        contactId: playground.id,
        messageContent: testMessage,
        messageType: 'TEXT',
        testMode: true,
      },
      { jobId: `test-${Date.now()}` },
    )
    console.log(`Mensagem de teste enfileirada: "${testMessage}"`)
    console.log(`Job ID: ${job.id} — o worker vai processar (server deve estar rodando).`)
    console.log('')
  }

  await db.$disconnect()
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
