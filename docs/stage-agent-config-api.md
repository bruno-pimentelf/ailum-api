# Stage Agent Config — API para Edição no Frontend

Configuração completa do agente de IA por stage. Use na tela de edição de stages.

---

## Endpoints

Base: `GET|PUT /v1/funnels/stages/:stageId/agent-config`

- `:stageId` — UUID do stage

---

## 1. Obter config do agente

```http
GET /v1/funnels/stages/:stageId/agent-config
Authorization: Bearer <session_token>
```

**Response 200**

```json
{
  "id": "uuid",
  "stageId": "uuid",
  "funnelAgentName": "Recepção",
  "funnelAgentPersonality": "Você é da recepção da clínica. Seja cordial...",
  "stageContext": "Contato inicial. Apresente a clínica...",
  "allowedTools": ["search_availability", "create_appointment", "move_stage", "send_message", "notify_operator"],
  "model": "SONNET",
  "temperature": 0.4,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**Response 404** — stage sem config

---

## 2. Salvar config do agente (upsert)

```http
PUT /v1/funnels/stages/:stageId/agent-config
Authorization: Bearer <session_token>
Content-Type: application/json
```

**Body** (todos os campos opcionais)

```json
{
  "funnelAgentName": "string",
  "funnelAgentPersonality": "string",
  "stageContext": "string",
  "allowedTools": ["string"],
  "model": "HAIKU" | "SONNET",
  "temperature": 0
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `funnelAgentName` | string | Nome do assistente (ex: "Recepção") |
| `funnelAgentPersonality` | string | Tom e personalidade — como o assistente fala e age |
| `stageContext` | string | O que fazer neste estágio — instruções específicas |
| `allowedTools` | string[] | Tools permitidas (ver lista abaixo) |
| `model` | "HAIKU" \| "SONNET" | Modelo de IA (Haiku mais rápido, Sonnet mais capaz) |
| `temperature` | number 0–1 | Criatividade (0.3–0.4 recomendado) |

**Tools válidas:**
- `search_availability` — busca horários
- `create_appointment` — cria agendamento
- `generate_pix` — gera cobrança PIX
- `move_stage` — avança contato no funil
- `notify_operator` — transfere para humano
- `send_message` — envia mensagem

**Response 200** — config atualizado (mesmo shape do GET)

---

## Sugestão de UI para edição

| Campo | Widget sugerido |
|-------|-----------------|
| `funnelAgentName` | Input texto curto |
| `funnelAgentPersonality` | Textarea (3–5 linhas) — "Tom e personalidade" |
| `stageContext` | Textarea (3–5 linhas) — "Instruções do estágio" |
| `allowedTools` | Multi-select ou checkboxes |
| `model` | Select (HAIKU / SONNET) |
| `temperature` | Slider 0–1 ou input number |
