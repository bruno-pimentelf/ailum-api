# Guia de Integração — Templates de Mensagem

Como criar, gerenciar e integrar templates de mensagem em toda a plataforma (lembretes, triggers, playground).

---

## 1. Visão geral

Templates são mensagens reutilizáveis com variáveis (`{{name}}`, `{{appointmentTime}}`, etc.) que podem ser usadas em:

| Local | Como usa |
|-------|----------|
| **Lembretes** | Templates com chaves fixas `reminder_24h` e `reminder_1h` — se existirem, substituem a mensagem padrão |
| **Triggers** | Campo `templateId` no `actionConfig` do trigger SEND_MESSAGE — envia template em vez de texto inline |
| **Playground** | Lembretes e mensagens de template aparecem no chat do playground (sem envio via WhatsApp) |

---

## 2. API de Templates

**Base:** `GET/POST /v1/templates`, `GET/PATCH/DELETE /v1/templates/:id`  
**Auth:** `credentials: 'include'` (cookie de sessão)

### Listar templates
```
GET /v1/templates
```
**Response 200:** array de `MessageTemplate`

### Criar template
```
POST /v1/templates
Content-Type: application/json
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `key` | sim | Identificador único (ex: `reminder_24h`, `welcome`). Apenas `a-z`, `0-9`, `_`, `-` |
| `name` | sim | Nome exibido na UI |
| `description` | não | Descrição opcional |
| `type` | sim | `TEXT` \| `IMAGE` \| `AUDIO` \| `VIDEO` \| `DOCUMENT` |
| `body` | sim | Texto principal (para TEXT = mensagem; para mídia = pode ficar vazio) |
| `mediaUrl` | sim* | Obrigatório para IMAGE, AUDIO, VIDEO, DOCUMENT |
| `caption` | não | Legenda para IMAGE, VIDEO, DOCUMENT |
| `fileName` | não | Nome do arquivo para DOCUMENT |
| `variables` | não | Array de variáveis usadas (ex: `["name", "appointmentTime"]`) — informativo |

### Atualizar template
```
PATCH /v1/templates/:id
```
Mesmos campos do POST (parciais). `key` não pode ser alterado.

### Excluir template
```
DELETE /v1/templates/:id
```

### Variáveis disponíveis

| Variável | Descrição |
|----------|-----------|
| `{{name}}` | Nome do contato |
| `{{appointmentTime}}` | Data e hora da consulta (pt-BR) |
| `{{appointmentDate}}` | Só a data |
| `{{appointmentTimeOnly}}` | Só o horário |
| `{{professionalName}}` | Nome do profissional |
| `{{serviceName}}` | Nome do serviço |

---

## 3. Chaves reservadas (Lembretes)

Estas chaves têm significado especial e são usadas automaticamente pelo job de lembretes:

| Chave | Quando envia | Se não existir |
|-------|--------------|----------------|
| `reminder_24h` | 23–25h antes da consulta | Usa mensagem padrão |
| `reminder_1h` | 50–70 min antes da consulta | Usa mensagem padrão |

**Recomendação:** na tela de templates, mostrar badges ou hints para essas chaves: "Lembrete 24h" e "Lembrete 1h" e explicar que são usadas automaticamente.

---

## 4. Tela de gestão de templates (UX)

### Estrutura sugerida

1. **Listagem**
   - Tabela ou cards: Nome, Tipo, Chave, Descrição resumida
   - Botão "Novo template"
   - Ações: Editar, Excluir

2. **Formulário de criação/edição**
   - **Tipo de mensagem:** select (TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT)
   - **Chave:** input com validação (`a-z0-9_-`), desabilitado na edição
   - **Nome:** input obrigatório
   - **Descrição:** textarea opcional
   - **Corpo da mensagem / Legenda:**
     - Para TEXT: textarea grande com placeholder mostrando variáveis
     - Para IMAGE/VIDEO/DOCUMENT: campo de URL da mídia + caption
   - **Variáveis:** autocomplete ou chips ao digitar `{{` — lista: name, appointmentTime, appointmentDate, appointmentTimeOnly, professionalName, serviceName

3. **Preview**
   - Botão "Visualizar" que substitui variáveis por valores de exemplo (ex: nome "Maria", data "15/03/2026 10:00") — ajuda o usuário a conferir o resultado.

4. **Dicas visuais**
   - Para chave `reminder_24h` ou `reminder_1h`: badge "Usado automaticamente em lembretes"
   - Tooltip explicando cada variável ao passar o mouse

### Validação no frontend
- `key`: regex `^[a-z0-9_-]+$`, único no tenant
- `type` IMAGE/VIDEO/AUDIO/DOCUMENT: `mediaUrl` obrigatório
- `body` obrigatório para TEXT

---

## 5. Triggers e templates

### Configuração atual (texto inline)
O `actionConfig` de um trigger SEND_MESSAGE já suporta:
```json
{
  "message": "Olá, {{name}}! Sua consulta é em {{appointmentTime}}.",
  "useAI": false
}
```

### Nova opção (template)
Se o frontend enviar `templateId`:
```json
{
  "templateId": "uuid-do-template"
}
```
O backend usa o template completo (incluindo IMAGE, VIDEO, etc.) e ignora `message`.

### UX sugerida no editor de triggers

1. **Modo de mensagem:** dois radios ou tabs
   - "Texto personalizado" — mostra textarea com `message` e toggle `useAI`
   - "Usar template" — select com lista de templates (TEXT + IMAGE, etc.)

2. **Select de template**
   - `GET /v1/templates` — exibir nome, tipo, chave
   - Placeholder: "Selecione um template"
   - Se template for IMAGE/VIDEO/DOCUMENT: aviso "Será enviado como [tipo]"

3. **Manter compatibilidade**
   - Se o trigger já tem `message`, não apagar ao escolher "Usar template" — só mudar para `templateId`
   - Ao voltar para "Texto personalizado", restaurar `message` se existir

4. **Navegação**
   - Link "Criar novo template" que abre modal ou redireciona para `/templates/new`, e ao salvar retorna ao trigger com o template selecionado

---

## 6. Playground e templates

### O que acontece no playground

- Contato do playground: `phone: "__playground__"`
- Lembretes e mensagens de template **não enviam** para o WhatsApp
- A mensagem **é salva** no banco e sincronizada no Firestore
- O chat do playground exibe a mensagem em tempo real

### Como testar lembretes no playground

1. Obter o contato: `GET /v1/agent/playground-contact`
2. Garantir que existe consulta CONFIRMED para esse contato em uma das janelas:
   - **24h:** agendar para daqui a 23–25h
   - **1h:** agendar para daqui a 50–70 min
3. O job de lembretes roda a cada 30 min — aguardar ou ajustar horário para estar dentro da janela quando o job executar
4. A mensagem aparecerá no chat do playground via Firestore

### Dica UX

Na tela do playground, exibir um aviso ou hint:  
*"Lembretes configurados (ex.: reminder_24h, reminder_1h) aparecem aqui quando houver consulta na janela correta. O job roda a cada 30 min."*

---

## 7. Ordem de setup recomendada

1. **Templates base (opcional)**
   - Criar `reminder_24h` e `reminder_1h` via `POST /v1/templates` se quiser customizar lembretes
   - Se não criar, o sistema usa mensagens padrão

2. **Triggers**
   - Criar triggers com `message` inline ou `templateId`
   - Se usar `templateId`, garantir que o template existe antes

3. **Playground**
   - Sem configuração extra; templates e lembretes funcionam automaticamente para o contato `__playground__`

---

## 8. Relacionamentos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TEMPLATES (GET/POST /v1/templates)                 │
│  key, name, type, body, mediaUrl, caption, variables                         │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         │ chave fixa (reminder_24h, reminder_1h)
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LEMBRETES (job a cada 30 min)                                               │
│  Busca templates por chave → se existe, usa; senão, mensagem padrão          │
│  Contato playground → não envia WhatsApp, só salva no Firestore              │
└─────────────────────────────────────────────────────────────────────────────┘

         │ templateId
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TRIGGERS (SEND_MESSAGE)                                                     │
│  actionConfig.templateId → usa template                                      │
│  actionConfig.message → texto inline (comportamento anterior)                │
└─────────────────────────────────────────────────────────────────────────────┘

         │ mensagens aparecem no chat
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLAYGROUND                                                                  │
│  Contato __playground__ → Firestore onSnapshot → chat em tempo real          │
│  Lembretes e triggers com template: aparecem no chat sem envio WhatsApp      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Permissões

| Permissão | Quem tem |
|-----------|----------|
| `templates:read` | ADMIN, SECRETARY |
| `templates:write` | ADMIN, SECRETARY |

PROFESSIONAL não tem acesso a templates.

---

## 10. Resumo rápido

| Ação | Endpoint / local |
|------|-------------------|
| Listar templates | `GET /v1/templates` |
| Criar template | `POST /v1/templates` |
| Editar template | `PATCH /v1/templates/:id` |
| Usar em lembrete | Criar com key `reminder_24h` ou `reminder_1h` |
| Usar em trigger | `actionConfig: { templateId: "uuid" }` |
| Testar no playground | Agendar consulta no contato playground dentro da janela e aguardar job |
