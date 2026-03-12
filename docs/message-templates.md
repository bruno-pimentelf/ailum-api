# Templates de Mensagem

Sistema centralizado de templates reutilizáveis em lembretes, triggers e outras partes da plataforma.

---

## Modelo

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | ID do template |
| `key` | string | Chave única por tenant (ex: `reminder_24h`, `welcome`) |
| `name` | string | Nome amigável |
| `description` | string? | Descrição opcional |
| `type` | TEXT \| IMAGE \| AUDIO \| VIDEO \| DOCUMENT | Tipo da mensagem |
| `body` | string | Texto principal (obrigatório; para TEXT é a mensagem) |
| `mediaUrl` | string? | URL da mídia (obrigatório para IMAGE, AUDIO, VIDEO, DOCUMENT) |
| `caption` | string? | Legenda (para IMAGE, VIDEO, DOCUMENT) |
| `fileName` | string? | Nome do arquivo (para DOCUMENT) |
| `variables` | string[] | Lista de variáveis esperadas |

---

## Variáveis disponíveis

| Variável | Descrição |
|----------|-----------|
| `{{name}}` | Nome do contato |
| `{{appointmentTime}}` | Data e hora da consulta (formato pt-BR) |
| `{{appointmentDate}}` | Só a data |
| `{{appointmentTimeOnly}}` | Só o horário |
| `{{professionalName}}` | Nome do profissional |
| `{{serviceName}}` | Nome do serviço |

---

## Chaves reservadas para lembretes

O job de lembretes busca templates pelas chaves:

| Chave | Momento | Fallback (se não existir) |
|-------|---------|---------------------------|
| `reminder_24h` | 24h antes da consulta | Mensagem padrão hardcoded |
| `reminder_1h` | 1h antes da consulta | Mensagem padrão hardcoded |

---

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/v1/templates` | Lista templates do tenant |
| GET | `/v1/templates/:id` | Obtém template por ID |
| POST | `/v1/templates` | Cria template |
| PATCH | `/v1/templates/:id` | Atualiza template |
| DELETE | `/v1/templates/:id` | Remove template |

### Exemplo de POST (TEXT)

```json
{
  "key": "reminder_24h",
  "name": "Lembrete 24h",
  "description": "Enviado um dia antes da consulta",
  "type": "TEXT",
  "body": "Olá, {{name}}! Lembrando que você tem uma consulta de {{serviceName}} amanhã ({{appointmentDate}}) às {{appointmentTimeOnly}} com {{professionalName}}. Confirma sua presença? Responda SIM para confirmar.",
  "variables": ["name", "serviceName", "appointmentDate", "appointmentTimeOnly", "professionalName"]
}
```

### Exemplo de POST (IMAGE com legenda)

```json
{
  "key": "welcome_image",
  "name": "Boas-vindas com imagem",
  "type": "IMAGE",
  "body": "",
  "mediaUrl": "https://exemplo.com/logo.png",
  "caption": "Olá, {{name}}! Bem-vindo à nossa clínica.",
  "variables": ["name"]
}
```

---

## Integrações

### Triggers

No `actionConfig` do trigger SEND_MESSAGE:

- `message`: texto inline com `{{name}}`, `{{appointmentTime}}` (comportamento atual)
- `templateId`: ID do template — usa o template em vez de `message` e suporta múltiplos tipos

### Lembretes

- Se existir template com `key` `reminder_24h` ou `reminder_1h`, usa o template
- Caso contrário, usa a mensagem padrão

### Playground

Lembretes e mensagens de template que forem para o contato `__playground__` **não enviam** via WhatsApp, mas **salvam no DB e sincronizam no Firestore**, aparecendo no chat do playground.
