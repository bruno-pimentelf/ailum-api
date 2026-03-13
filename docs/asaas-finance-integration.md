# Integração Asaas Financeiro — Ailum

Documentação das APIs do módulo financeiro (Asaas) para uso no frontend do Ailum.

## Pré-requisitos

- Integração Asaas configurada (`PUT /v1/integrations/asaas` com `apiKey`).
- Permissões: `BILLING_READ` para leitura, `BILLING_WRITE` para emissão de notas fiscais.

---

## Endpoints

Base: `GET|POST /v1/integrations/asaas/...`  
Auth: Bearer token (sessão autenticada).

### 1. Saldo da conta

```http
GET /v1/integrations/asaas/finance/balance
```

**Resposta**
```json
{
  "balance": 5210.96
}
```

**Uso no front:** Card de saldo no topo do dashboard financeiro. Atualizar periodicamente (evitar polling agressivo; sugestão: a cada 30–60s ou sob demanda).

---

### 2. Listar clientes

```http
GET /v1/integrations/asaas/customers?offset=0&limit=20&name=João&cpfCnpj=42885229519&externalReference=uuid-contato-ailum
```

| Query        | Tipo   | Descrição                          |
|-------------|--------|------------------------------------|
| `offset`    | number | Paginação (padrão 0)               |
| `limit`     | number | Itens por página (padrão 10, máx 100) |
| `name`      | string | Filtro por nome                    |
| `email`     | string | Filtro por e-mail                  |
| `cpfCnpj`   | string | Filtro por CPF/CNPJ                |
| `externalReference` | string | ID do contato no Ailum (UUID) |

**Resposta**
```json
{
  "object": "list",
  "hasMore": false,
  "totalCount": 15,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "id": "cus_000005401844",
      "name": "João Silva",
      "email": "joao@email.com",
      "phone": "11999999999",
      "cpfCnpj": "42885229519",
      "externalReference": "4cc35f67-a17f-4694-92b5-be124be1b589",
      "dateCreated": "2024-07-12"
    }
  ]
}
```

**Uso no front:**
- Tabela de clientes com busca (nome, CPF) e paginação.
- `externalReference` serve para vincular ao contato do Ailum e abrir o perfil.

---

### 3. Listar cobranças

```http
GET /v1/integrations/asaas/payments?offset=0&limit=20&customer=cus_xxx&status=RECEIVED&billingType=PIX&dateCreatedGe=2024-01-01&dateCreatedLe=2024-12-31&paymentDateGe=2024-03-01
```

| Query           | Tipo   | Descrição                                  |
|-----------------|--------|--------------------------------------------|
| `offset`        | number | Paginação                                  |
| `limit`         | number | Itens por página (máx 100)                 |
| `customer`      | string | ID do cliente Asaas                        |
| `billingType`   | string | `PIX`, `BOLETO`, `CREDIT_CARD`, `DEBIT_CARD` |
| `status`        | string | `PENDING`, `RECEIVED`, `OVERDUE`, `REFUNDED`, etc. |
| `externalReference` | string | UUID do contato no Ailum               |
| `dateCreatedGe` | string | Data criação inicial (YYYY-MM-DD)          |
| `dateCreatedLe` | string | Data criação final                        |
| `dueDateGe`     | string | Vencimento inicial                        |
| `dueDateLe`     | string | Vencimento final                          |
| `paymentDateGe` | string | Pagamento (recebido) inicial               |
| `paymentDateLe` | string | Pagamento final                           |

**Resposta**
```json
{
  "object": "list",
  "hasMore": true,
  "totalCount": 42,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "id": "pay_q1mlvqqjuljvi2f6",
      "dateCreated": "2026-03-13",
      "customer": "cus_000007670276",
      "value": 447,
      "netValue": 446.01,
      "billingType": "PIX",
      "status": "RECEIVED",
      "dueDate": "2026-03-14",
      "paymentDate": "2026-03-13",
      "description": "Consulta padrão com Dr. Bruno...",
      "externalReference": "4cc35f67-a17f-4694-92b5-be124be1b589",
      "invoiceUrl": "https://sandbox.asaas.com/i/q1mlvqqjuljvi2f6"
    }
  ]
}
```

**Uso no front:**
- Tabela de cobranças com filtros (status, tipo, datas).
- Colunas sugeridas: Data, Cliente, Valor, Tipo, Status, Link fatura.
- `externalReference` para abrir o contato no Ailum.

---

### 4. Serviços municipais (para NF)

```http
GET /v1/integrations/asaas/municipal-options
```

**Resposta**
```json
{
  "data": [
    {
      "id": "svc_xxx",
      "code": "1.01",
      "name": "Análise e desenvolvimento de sistemas"
    }
  ]
}
```

**Uso no front:** Select para escolher o serviço municipal ao agendar NF. O valor selecionado será enviado como `municipalServiceId` ou `municipalServiceCode` no `POST /asaas/invoices`.

---

### 5. Agendar nota fiscal

```http
POST /v1/integrations/asaas/invoices
Content-Type: application/json

{
  "payment": "pay_q1mlvqqjuljvi2f6",
  "serviceDescription": "Consulta médica - Dermatologia",
  "observations": "Consulta realizada em 16/03/2026",
  "value": 447,
  "deductions": 0,
  "effectiveDate": "2026-03-16",
  "municipalServiceName": "Consulta médica",
  "municipalServiceId": "svc_xxx",
  "municipalServiceCode": "1.05",
  "externalReference": "appointment-uuid",
  "updatePayment": false,
  "taxes": {
    "retainIss": true,
    "iss": 2,
    "pis": 0.65,
    "cofins": 3,
    "csll": 0,
    "inss": 0,
    "ir": 0
  }
}
```

| Campo                 | Obrigatório | Descrição                                              |
|-----------------------|-------------|--------------------------------------------------------|
| `payment`             | Sim         | ID da cobrança no Asaas                                |
| `serviceDescription`  | Sim         | Descrição dos serviços                                 |
| `observations`        | Sim         | Observações                                            |
| `value`               | Sim         | Valor total da nota                                    |
| `deductions`          | Não         | Deduções (padrão 0)                                    |
| `effectiveDate`       | Sim         | Data de emissão (YYYY-MM-DD)                           |
| `municipalServiceName`| Sim         | Nome do serviço municipal                              |
| `municipalServiceId`  | Não*        | ID do serviço em `municipal-options`                   |
| `municipalServiceCode`| Não*        | Código do serviço (um de `Id` ou `Code` é obrigatório) |
| `externalReference`   | Não         | ID da consulta/contato no Ailum                        |
| `updatePayment`       | Não         | Atualizar cobrança com impostos deduzidos              |
| `taxes`               | Sim         | Objeto de impostos (veja abaixo)                       |

**taxes**
| Campo              | Tipo    | Exemplo | Descrição          |
|--------------------|---------|---------|--------------------|
| `retainIss`        | boolean | true    | Tomador retém ISS? |
| `iss`              | number  | 2       | Alíquota ISS (%)   |
| `pis`              | number  | 0.65    | Alíquota PIS (%)   |
| `cofins`           | number  | 3       | Alíquota COFINS (%)|
| `csll`             | number  | 0       | Alíquota CSLL (%)  |
| `inss`             | number  | 0       | Alíquota INSS (%)  |
| `ir`               | number  | 0       | Alíquota IR (%)    |

**Resposta (201)**
```json
{
  "id": "inv_000000000232",
  "status": "SCHEDULED",
  "payment": "pay_q1mlvqqjuljvi2f6",
  "value": 447,
  "pdfUrl": null,
  "xmlUrl": null
}
```

**Uso no front:**
- Modal “Emitir NF” ao lado da cobrança recebida.
- Buscar `municipal-options` para popular o select.
- Permitir configuração padrão de impostos por tenant (futuro).
- Após sucesso, exibir status e links (quando disponíveis).

---

### 6. Links de pagamento

#### Listar links

```http
GET /v1/integrations/asaas/payment-links?offset=0&limit=20&active=true&name=Consulta&externalReference=uuid
```

| Query              | Tipo    | Descrição                    |
|--------------------|---------|------------------------------|
| `offset`           | number  | Paginação                    |
| `limit`            | number  | Itens por página             |
| `active`           | boolean | Filtro por ativo/inativo     |
| `name`             | string  | Filtro por nome              |
| `externalReference`| string  | ID no Ailum para tracking    |

**Resposta:** Lista com `id`, `name`, `url`, `value`, `chargeType`, `billingType`, `viewCount`, `active`, etc.

#### Criar link

```http
POST /v1/integrations/asaas/payment-links
Content-Type: application/json

{
  "name": "Consulta avulsa",
  "description": "Pagamento de consulta",
  "value": 200,
  "billingType": "UNDEFINED",
  "chargeType": "DETACHED",
  "dueDateLimitDays": 5,
  "externalReference": "link-consulta-uuid"
}
```

| Campo                 | Obrigatório | Descrição                                                                 |
|-----------------------|-------------|---------------------------------------------------------------------------|
| `name`                | Sim         | Nome do link                                                              |
| `billingType`         | Sim         | `UNDEFINED` (todos), `PIX`, `BOLETO`, `CREDIT_CARD`                       |
| `chargeType`          | Sim         | `DETACHED` (avulso), `INSTALLMENT` (parcelado), `RECURRENT` (assinatura)  |
| `value`               | Não         | Valor fixo; omitir para cliente definir                                   |
| `subscriptionCycle`   | Não*        | Obrigatório se `chargeType=RECURRENT`: `WEEKLY`, `MONTHLY`, etc.          |
| `maxInstallmentCount` | Não*        | Máx parcelas se `chargeType=INSTALLMENT`                                  |
| `dueDateLimitDays`    | Não         | Dias úteis para boleto (se `billingType=BOLETO`)                          |
| `externalReference`   | Não         | ID no Ailum para tracking                                                 |
| `callback`            | Não         | `{ successUrl, autoRedirect }` — redirecionamento pós-pagamento           |

**Resposta (201):** `{ id, url, viewCount, ... }` — use `url` para enviar ao cliente (WhatsApp, e-mail).

#### Detalhe de um link (tracking)

```http
GET /v1/integrations/asaas/payment-links/:id
```

**Resposta:** Objeto completo com `viewCount` (visualizações), `url`, `active`, etc.

---

### 7. Assinaturas

#### Listar assinaturas

```http
GET /v1/integrations/asaas/subscriptions?offset=0&limit=20&customer=cus_xxx&status=ACTIVE&externalReference=uuid
```

| Query              | Tipo   | Descrição                            |
|--------------------|--------|--------------------------------------|
| `offset`           | number | Paginação                            |
| `limit`            | number | Itens por página                     |
| `customer`         | string | ID do cliente Asaas                  |
| `billingType`      | string | `BOLETO`, `CREDIT_CARD`, `PIX`, etc. |
| `status`           | string | `ACTIVE`, `EXPIRED`, `INACTIVE`      |
| `externalReference`| string | ID no Ailum                          |

**Resposta:** Lista com `id`, `customer`, `value`, `cycle`, `nextDueDate`, `status`, `description`, etc.

#### Criar assinatura (por cliente)

```http
POST /v1/integrations/asaas/subscriptions
Content-Type: application/json

{
  "customer": "cus_000007670276",
  "billingType": "PIX",
  "value": 99.90,
  "nextDueDate": "2026-04-15",
  "cycle": "MONTHLY",
  "description": "Plano mensal de acompanhamento"
}
```

| Campo               | Obrigatório | Descrição                                                                    |
|---------------------|-------------|------------------------------------------------------------------------------|
| `customer`          | Sim         | ID do cliente no Asaas                                                       |
| `billingType`       | Sim         | `BOLETO`, `CREDIT_CARD`, `PIX`, `UNDEFINED`                                  |
| `value`             | Sim         | Valor da mensalidade                                                         |
| `nextDueDate`       | Sim         | Vencimento da primeira cobrança (YYYY-MM-DD)                                 |
| `cycle`             | Sim         | `WEEKLY`, `MONTHLY`, `BIMONTHLY`, `QUARTERLY`, `SEMIANNUALLY`, `YEARLY`      |
| `description`       | Não         | Descrição                                                                    |
| `externalReference` | Não         | ID no Ailum                                                                  |

**Resposta (201):** `{ id, status, nextDueDate, ... }`

---

## Dicas de UI/UX

### Dashboard Financeiro

1. **Cards no topo**
   - Saldo disponível (GET `/asaas/finance/balance`).
   - Total recebido no mês (filtro `paymentDateGe`/`paymentDateLe` + `status=RECEIVED`).
   - Cobranças pendentes (filtro `status=PENDING`).

2. **Tabela de cobranças**
   - Filtros: período, status, tipo (PIX/Boleto/Cartão).
   - Paginação com `offset` e `limit`.
   - Ações: ver fatura (link `invoiceUrl`), emitir NF (se ainda não tiver).

3. **Clientes**
   - Listagem com busca por nome/CPF.
   - Link para o contato no Ailum via `externalReference` quando existir.

4. **Estados vazios**
   - Sem integração Asaas: mensagem “Configure a integração Asaas em Configurações”.
   - Lista vazia: “Nenhuma cobrança/cliente encontrado”.

5. **Atualização**
   - Evitar polling intenso. Usar refresh manual ou intervalo de 30–60s.
   - Webhooks do Asaas já atualizam o backend; o front pode confiar nos dados retornados.

---

## Estrutura sugerida — Módulo Financeiro no Ailum

### Navegação (sidebar / menu)

```
Financeiro
├── Visão geral     (dashboard)
├── Cobranças       (tabela payments)
├── Clientes        (tabela customers)
├── Links de pagamento
├── Assinaturas
└── Configurações   (Asaas, NF, impostos padrão)
```

### 1. Visão geral (dashboard)

- **Cards:** Saldo, Recebido no mês, Pendente, Vencido
- **Gráfico (opcional):** Receita por dia/semana/mês
- **Ações rápidas:** Novo link, Nova assinatura

### 2. Cobranças

- **Tabela:** Data, Cliente, Valor, Tipo (PIX/Boleto/Cartão), Status, Fatura, Emitir NF
- **Filtros:** Período, status, tipo, cliente
- **Paginação:** offset/limit
- **Ação:** Emitir NF (modal) — usa `municipal-options` e `taxes`

### 3. Clientes

- **Tabela:** Nome, CPF, E-mail, Telefone, Link para contato
- **Busca:** Por nome ou CPF
- **Link:** Se `externalReference` existe, abrir contato no Ailum

### 4. Links de pagamento

- **Tabela:** Nome, Valor, Tipo (avulso/parcelado/assinatura), Visualizações, Status, URL, Ações
- **Botão:** Criar link → modal com formulário (name, value, chargeType, billingType, etc.)
- **Ações:** Copiar URL, Ver detalhes (viewCount), Desativar (no Asaas)
- **Tracking:** Exibir `viewCount` como indicador de engajamento

### 5. Assinaturas

- **Tabela:** Cliente, Valor, Ciclo, Próximo vencimento, Status
- **Botão:** Nova assinatura → modal (exige `customer` do Asaas — buscar em customers)
- **Filtros:** Status (ACTIVE, INACTIVE, EXPIRED), cliente

### 6. Fluxo sugerido para Links

1. Usuário clica em **Criar link**
2. Modal com: Nome, Descrição, Valor (opcional), Tipo de cobrança (avulso/parcelado/assinatura), Formas de pagamento (PIX, Boleto, Cartão)
3. Se parcelado: campo `maxInstallmentCount`
4. Se assinatura: select `subscriptionCycle` (mensal, trimestral, etc.)
5. Opcional: URL de sucesso (`callback.successUrl`) para redirecionar após pagamento
6. Ao salvar, exibir o `url` com botão **Copiar** — usuário envia no WhatsApp, e-mail, etc.
7. Na listagem, mostrar `viewCount` para acompanhar cliques

### 7. Permissões

- `BILLING_READ`: Ver todos os dados (cobranças, clientes, links, assinaturas, saldo)
- `BILLING_WRITE`: Criar links, assinaturas, emitir NF

---

## Status de cobranças (referência)

| Status      | Significado                    |
|-------------|--------------------------------|
| PENDING     | Aguardando pagamento           |
| RECEIVED    | Pago                           |
| OVERDUE     | Vencido                        |
| REFUNDED    | Estornado                      |
| CONFIRMED   | Confirmado (PIX)               |
| DELETED     | Cobrança removida              |

---

## Erros comuns

| Código | Significado                                    |
|--------|------------------------------------------------|
| 404    | Integração Asaas não configurada para o tenant |
| 401    | Token inválido ou expirado                     |
| 403    | Sem permissão (ex.: BILLING_WRITE para NF)     |
| 400    | Dados inválidos (Asaas retorna detalhes)       |
