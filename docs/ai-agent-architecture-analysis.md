# Análise da Arquitetura de Agentes de IA — Ailum

**Documento de pesquisa e recomendações** para o sistema de agentes de CRM com agendamento via WhatsApp.

---

## 1. Resumo Executivo

A infraestrutura de IA do Ailum segue um padrão hierárquico sólido: Router → Stage Agent → Tool Executor. O fluxo está bem desenhado, mas havia um **bug crítico** no contexto para agendamento **“hoje”**: profissionais disponíveis não incluíam `services`, fazendo com que a IA não tivesse `service_id` válido para `create_appointment`. Isso foi corrigido.

Este documento resume a pesquisa em best practices (Anthropic, OpenAI, Cronofy, etc.), aponta problemas encontrados e propõe ajustes.

---

## 2. Arquitetura Atual

```
Webhook Z-API (mensagem WhatsApp)  →  agentQueue (BullMQ)  →  orchestrate()
                                                        ↓
POST /v1/agent/message (playground) ──────────────────────┘
                                                        ↓
                                    buildContext() → routeMessage() → runStageAgent()
                                                                    ↓
                                                    executeToolSafely() (search_availability, create_appointment, …)
                                                                    ↓
                                                    applyGuardrails() → resposta via ZAPI
```

### Componentes principais

| Componente | Função |
|-----------|--------|
| **Router** (Haiku) | Classifica intent (WANTS_SCHEDULE, CONFIRMING, etc.) e decide se escala |
| **Stage Agent** (Sonnet) | Conduz conversa, decide quais tools chamar, até 5 iterações |
| **Tool Executor** | Executa tools no banco (search_availability, create_appointment, move_stage, etc.) |
| **Guardrail Agent** | Valida resposta final antes de enviar |

### Fluxo de dados para agendamento

1. **search_availability(date)** → profissionais com `services[]` e `slots[]`
2. **create_appointment(professional_id, service_id, scheduled_at)** → cria o Appointment
3. O agente precisa usar `professional_id` e `service_id` **do mesmo** resultado de search_availability (ou do contexto para hoje)

---

## 3. Estado da Arte (pesquisa)

### 3.1 Anthropic – Tool use

- **Descrições detalhadas** são o fator mais importante para boa performance de tools
- **input_examples** ajudam em tools complexas, mas há relatos de incompatibilidade em algumas versões
- **strict: true** (Structured Outputs) garante que os parâmetros sigam exatamente o schema
- TypeBox produz JSON Schema compatível com a API
- Recomendado usar **Claude Opus 4.6** para cenários com várias tools e casos ambíguos

### 3.2 Padrão recomendado para agendamento

- **find_free_slots** + **create_event** (ou equivalentes) são padrão
- Fluxo: detectar intenção → buscar slots → confirmar com usuário → criar compromisso
- Manter histórico de conversa para multi-step (ex.: “agende amanhã às 9h”)
- Bidirecional com calendário: ler slots e criar eventos na mesma base de dados

### 3.3 CRM + Calendário

- Integração nativa com calendário (Google, Outlook, iCal) ou banco interno
- Evitar duplicação de agendamentos
- Extrair dados estruturados (nome, serviço, horário) via LLM antes de chamar tools

---

## 4. Problemas Identificados e Correções

### 4.1 Contexto “hoje” sem `services` — corrigido

**Antes:** `availableProfessionals` tinha `id`, `fullName`, `specialty`, `slots`, mas **não** `services`.

Para agendamento “hoje”, a IA tentava combinar profissional (do contexto) com `service_id` da lista plana `availableServices`, sem vínculo com o profissional. Isso gerava erros como “Serviço não encontrado” ou combinações inválidas.

**Correção:** Inclusão de `professionalServices` no `buildContext` e exposição de `services` em cada `availableProfessional`, no mesmo formato de `search_availability`.

### 4.2 Descrições das tools

As descrições estavam genéricas, com pouca orientação para formatos (ISO, timezone, IDs).

**Correção:** Descrições em português e mais detalhadas, incluindo:
- Uso correto de `professional_id` e `service_id` (sempre do mesmo resultado)
- Regra para montar `scheduled_at` a partir de data + slot (ex.: "09:00" → "2026-03-10T09:00:00-03:00")
- Indicação de que o `service_id` deve ser de um dos serviços do profissional escolhido

### 4.3 Prompt do stage agent

O Layer 5 mostrava só profissionais e slots; não indicava claramente os IDs de serviços por profissional.

**Correção:** Inclusão explícita de serviços por profissional:  
`slots 09:00, 10:00 | serviços Consulta[id=xxx], Retorno[id=yyy]`

---

## 5. Recomendações Adicionais

### 5.1 `tool_choice` e CONFIRMING

Atualmente: `tool_choice: { type: 'any' }` quando `intent === CONFIRMING` e confidence ≥ 0.7.

- Se o router errar (ex.: WANTS_SCHEDULE em vez de CONFIRMING), o agente pode não chamar `create_appointment`.
- Sugestão: ajustar exemplos do router para capturar mais variações de confirmação (“sim, quero esse horário”, “pode ser”, etc.).

### 5.2 Validação de `createdBy`

O Appointment exige `createdBy`. O agente usa `'agent'`. O schema aceita qualquer string; isso está adequado.

### 5.3 Considerar `strict: true` nas tools

Se o plano for Structured Outputs:

```ts
{
  name: 'create_appointment',
  input_schema: { ... },
  strict: true  // garante schema exato
}
```

Verificar suporte na versão atual do SDK Anthropic.

### 5.4 `input_examples` (opcional)

Para `create_appointment`:

```ts
input_examples: [
  {
    professional_id: '<uuid-profissional>',
    service_id: '<uuid-serviço>',
    scheduled_at: '2026-03-10T09:00:00-03:00',
  },
],
```

Há relatos de erro “Extra inputs are not permitted” em algumas versões; validar antes de habilitar em produção.

### 5.5 Modelo para tools complexas

Claude Opus 4.6 tende a lidar melhor com várias tools e casos ambíguos. Para cenários mais simples, Sonnet continua adequado.

---

## 6. Playground vs webhook

| Aspecto | Webhook Z-API | Playground (POST /agent/message) |
|---------|---------------|----------------------------------|
| Entrada | Payload Z-API | `contactId`, `message`, `testMode` |
| Contato | Criado/atualizado pelo webhook | `__playground__` |
| Envio WhatsApp | Sim | Não (testMode) |
| Fluxo do agente | Igual | Igual |

O fluxo do agente é o mesmo; apenas a origem da mensagem e o uso de `testMode` mudam.

---

## 7. Checklist de Debug para `create_appointment`

Ao investigar falhas:

1. **Contexto** – `availableProfessionals` e `search_availability` incluem `services` por profissional?
2. **Router** – Intent correto? CONFIRMING com confidence ≥ 0.7?
3. **Stage config** – Stage tem `create_appointment` em `allowedTools`?
4. **IDs** – `professional_id` e `service_id` vieram do mesmo profissional/serviço?
5. **scheduled_at** – Formato `YYYY-MM-DDTHH:mm:ss-03:00`?
6. **Conflitos** – Slot ainda está livre? Não conflita com outro agendamento?

---

## 8. Referências

- [Anthropic: How to implement tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- [Anthropic: Tool use with Claude](https://docs.anthropic.com/en/docs/tool-use)
- [Writing tools for agents (Anthropic Engineering)](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [OpenAI Function Calling + Calendar (Cronofy)](https://www.cronofy.com/blog/chatgpt-calendar-connectors)
- [AI Appointment Scheduling Guide 2025](https://p0stman.com/guides/ai-appointment-scheduling-automation-guide-2025.html)
