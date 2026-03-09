# Stage Config — Integração Frontend

Base: `GET /v1/funnels` já devolve funis com `stages` e cada stage traz `agentConfig`. O que falta no front é exibir/editar essa config.

---

## O que é Stage Config (agentConfig)

Cada **stage** (ex: Novo Lead, Qualificado) pode ter um `agentConfig` que define como o agente IA se comporta nesse stage:

| Campo | Descrição |
|-------|-----------|
| `funnelAgentName` | Nome do assistente (ex: "Ailum") |
| `funnelAgentPersonality` | Prompt de personalidade |
| `stageContext` | Contexto do stage para a IA |
| `allowedTools` | **O que importa para agendamento** — lista de tools que a IA pode chamar: `create_appointment`, `move_stage`, `send_message`, `notify_operator`, `generate_pix`. Sem `create_appointment`, o agente não consegue criar consultas. |
| `model` | `"HAIKU"` ou `"SONNET"` |
| `temperature` | 0–1 |

---

## Rotas

### Listar stages (já vem com agentConfig)

```
GET /v1/funnels/:funnelId/stages
```

**Response 200:**
```json
[
  {
    "id": "uuid",
    "name": "Novo Lead",
    "color": "#64748b",
    "order": 0,
    "isTerminal": false,
    "agentConfig": {
      "id": "uuid",
      "stageId": "uuid",
      "funnelAgentName": "Ailum",
      "funnelAgentPersonality": "...",
      "stageContext": "...",
      "allowedTools": ["create_appointment", "move_stage", "send_message", "notify_operator"],
      "model": "SONNET",
      "temperature": 0.4
    },
    "triggers": []
  }
]
```

> Se `agentConfig` for `null`, o stage não tem config e a IA não tem tools disponíveis.

---

### Buscar agent config de um stage

```
GET /v1/funnels/stages/:stageId/agent-config
```

**Response 200:** objeto `agentConfig` (mesmo shape acima)  
**Response 404:** stage sem config

---

### Criar/atualizar agent config

```
PUT /v1/funnels/stages/:stageId/agent-config
```

**Body (todos opcionais):**
```json
{
  "funnelAgentName": "string",
  "funnelAgentPersonality": "string",
  "stageContext": "string",
  "allowedTools": ["create_appointment", "move_stage", "send_message", "notify_operator"],
  "model": "HAIKU | SONNET",
  "temperature": 0.3
}
```

**Response 200:** objeto `agentConfig` atualizado/criado

---

## allowedTools — valores válidos

| Valor | O que faz |
|-------|-----------|
| `search_availability` | Busca horários disponíveis por data (chamada quando o usuário diz "amanhã", "terça", etc.) |
| `create_appointment` | Permite agendar consulta (obrigatório para fluxo de agendamento) |
| `move_stage` | Permite mover contato entre stages |
| `send_message` | Permite enviar mensagem programática |
| `notify_operator` | Permite escalar para humano |
| `generate_pix` | Permite gerar cobrança PIX |

---

## Resumo para o front

1. **Listar stages:** `GET /v1/funnels/:funnelId/stages` — já retorna `agentConfig` em cada stage.
2. **Editar config:** `PUT /v1/funnels/stages/:stageId/agent-config` — enviar `allowedTools` (e outros campos desejados). Para agendamento funcionar, incluir `create_appointment` em `allowedTools`.
