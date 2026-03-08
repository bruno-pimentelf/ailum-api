# Auth — Integração Frontend (Next.js 15+)

> Backend: Fastify + Better Auth com plugin `organization`  
> Base URL: `http://localhost:3001`  
> Auth base path: `/auth`  
> Todas as chamadas usam `credentials: 'include'` (cookies de sessão HTTP-only)

---

## Como funciona a sessão

Better Auth usa **cookies HTTP-only** (`better-auth.session_token`). O frontend nunca toca no token diretamente — o cookie é enviado automaticamente pelo browser em cada requisição.

O fluxo de autenticação tem **dois estágios obrigatórios**:
1. Login → obtém sessão de usuário
2. Setar organização ativa → habilita o `tenantId` na sessão (sem isso, todas as rotas `/v1/*` retornam `403`)

---

## Setup recomendado (Next.js 15)

### Instalar o cliente oficial

```bash
npm install better-auth
```

### Criar o cliente

```ts
// lib/auth-client.ts
import { createAuthClient } from 'better-auth/client'
import { organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  basePath: '/auth',
  plugins: [organizationClient()],
})
```

> Use o `authClient` para **todos** os fluxos abaixo. Ele gerencia os cookies automaticamente.

---

## Fluxos e chamadas

### 1. Cadastro

**`POST /auth/sign-up/email`**

```ts
const { data, error } = await authClient.signUp.email({
  email: 'bruno@clinica.com',
  password: 'senha123',
  name: 'Bruno Pimentel',
})
```

**Response `200`:**
```json
{
  "user": {
    "id": "user_abc123",
    "email": "bruno@clinica.com",
    "name": "Bruno Pimentel",
    "emailVerified": false,
    "createdAt": "2026-03-08T00:00:00.000Z"
  },
  "session": {
    "id": "sess_xyz",
    "userId": "user_abc123",
    "expiresAt": "2026-03-22T00:00:00.000Z"
  }
}
```

---

### 2. Login

**`POST /auth/sign-in/email`**

```ts
const { data, error } = await authClient.signIn.email({
  email: 'bruno@clinica.com',
  password: 'senha123',
})
```

**Response `200`:** igual ao cadastro.

**Response `401`:**
```json
{ "error": "Invalid credentials" }
```

> Após login bem-sucedido, o cookie de sessão é setado. **Próximo passo obrigatório: setar organização ativa.**

---

### 3. Obter sessão atual

**`GET /auth/get-session`**

```ts
const { data: session } = await authClient.getSession()
```

**Response `200` (sem org ativa):**
```json
{
  "user": { "id": "user_abc123", "name": "Bruno Pimentel", "email": "..." },
  "session": { "id": "sess_xyz", "activeOrganizationId": null, "expiresAt": "..." }
}
```

**Response `200` (com org ativa):**
```json
{
  "user": { "id": "user_abc123", "name": "Bruno Pimentel", "email": "..." },
  "session": {
    "id": "sess_xyz",
    "activeOrganizationId": "org_abc123",
    "expiresAt": "..."
  }
}
```

> Se `activeOrganizationId === null`, redirecionar para seleção ou criação de clínica.

---

### 4. Criar organização (clínica)

**`POST /auth/organization/create`**

```ts
const { data, error } = await authClient.organization.create({
  name: 'Clínica Exemplo',
  slug: 'clinica-exemplo',
})
```

**Body enviado:**
```json
{
  "name": "Clínica Exemplo",
  "slug": "clinica-exemplo"
}
```

**Response `200`:**
```json
{
  "id": "org_abc123",
  "name": "Clínica Exemplo",
  "slug": "clinica-exemplo",
  "createdAt": "2026-03-08T00:00:00.000Z"
}
```

> O backend cria automaticamente o registro espelho em `tenants` via hook `afterCreate`.

---

### 5. Setar organização ativa ⚠️ obrigatório antes de qualquer `/v1/*`

**`POST /auth/organization/set-active`**

```ts
const { data, error } = await authClient.organization.setActive({
  organizationId: 'org_abc123',
})
```

**Body enviado:**
```json
{ "organizationId": "org_abc123" }
```

**Response `200`:**
```json
{
  "session": {
    "id": "sess_xyz",
    "activeOrganizationId": "org_abc123",
    "expiresAt": "..."
  }
}
```

> Após isso, todas as rotas `/v1/*` funcionam. O backend lê `activeOrganizationId` da sessão para resolver o `tenantId`.

---

### 6. Listar organizações do usuário

**`GET /auth/organization/list`**

```ts
const { data } = await authClient.organization.list()
```

**Response `200`:**
```json
[
  {
    "id": "org_abc123",
    "name": "Clínica Exemplo",
    "slug": "clinica-exemplo",
    "role": "admin"
  }
]
```

> Usar para montar o seletor de clínica na interface.

---

### 7. Logout

**`POST /auth/sign-out`**

```ts
await authClient.signOut()
```

**Response `200`:** cookie de sessão é invalidado.

---

### 8. Esqueci minha senha

**`POST /auth/forget-password`**

```ts
await authClient.forgetPassword({
  email: 'bruno@clinica.com',
  redirectTo: 'http://localhost:3000/reset-password',
})
```

**Body:**
```json
{
  "email": "bruno@clinica.com",
  "redirectTo": "http://localhost:3000/reset-password"
}
```

**Response `200`:** email enviado (via Resend).

---

### 9. Redefinir senha

**`POST /auth/reset-password`**

```ts
await authClient.resetPassword({
  token: searchParams.get('token'), // token da URL recebida no email
  newPassword: 'novaSenha456',
})
```

**Body:**
```json
{
  "token": "reset_token_do_email",
  "newPassword": "novaSenha456"
}
```

**Response `200`:** senha atualizada.

---

### 10. Aceitar convite de membro

O link de convite chega no email com formato:  
`http://localhost:3000/invite/{invitationId}`

**`POST /auth/organization/accept-invitation`**

```ts
const { data, error } = await authClient.organization.acceptInvitation({
  invitationId: params.invitationId,
})
```

**Body:**
```json
{ "invitationId": "inv_abc123" }
```

**Response `200`:** usuário é adicionado à organização. O backend cria o `TenantMember` via hook `afterCreate`.

> Se o usuário ainda não tem conta, redirecionar para cadastro primeiro e depois aceitar o convite.

---

## Fluxo completo de onboarding (primeira vez)

```
1. /sign-up          → criar conta
2. /auth/organization/create → criar clínica
3. /auth/organization/set-active → ativar org
4. → redirecionar para /dashboard
```

## Fluxo de login (usuário existente com 1 clínica)

```
1. /auth/sign-in/email
2. GET /auth/organization/list → pegar org do usuário
3. /auth/organization/set-active → ativar org
4. → redirecionar para /dashboard
```

## Fluxo de login (usuário com múltiplas clínicas)

```
1. /auth/sign-in/email
2. GET /auth/organization/list → listar orgs
3. → exibir seletor de clínica
4. /auth/organization/set-active → ativar org selecionada
5. → redirecionar para /dashboard
```

---

## Middleware de proteção de rotas (Next.js)

```ts
// middleware.ts (raiz do projeto)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/sign-up', '/invite', '/reset-password', '/forgot-password']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r))

  // O cookie de sessão do Better Auth
  const sessionCookie = request.cookies.get('better-auth.session_token')

  if (!sessionCookie && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
}
```

> A verificação de `activeOrganizationId` deve ser feita no Server Component do layout do dashboard, chamando `GET /auth/get-session`. Se `activeOrganizationId` for nulo, redirecionar para `/select-org`.

---

## Verificação de permissões no frontend

O objeto de sessão não retorna as permissões diretamente. Use o role para controle de UI:

```ts
// Após login, GET /auth/get-session + GET /v1/members (lista do tenant)
// O role do usuário atual está em TenantMember.role: 'ADMIN' | 'PROFESSIONAL' | 'SECRETARY'

const PERMISSIONS = {
  ADMIN: ['contacts', 'billing', 'scheduling', 'funnels', 'members', 'agent_config'],
  PROFESSIONAL: ['contacts:read', 'billing:read', 'scheduling:read'],
  SECRETARY: ['contacts', 'billing', 'scheduling'],
}
```

---

## Erros comuns e tratamento

| Status | Mensagem | Causa | Ação |
|--------|----------|-------|------|
| `401` | `Unauthorized` | Cookie inválido ou expirado | Redirecionar para `/login` |
| `403` | `No active organization selected` | `set-active` não foi chamado | Redirecionar para `/select-org` |
| `403` | `Not a member of this tenant` | Usuário removido da clínica | Logout + mensagem de erro |
| `403` | `Insufficient permissions` | Role sem permissão | Ocultar UI, não redirecionar |
| `429` | `Rate limit exceeded` | Muitas requisições | Retry com backoff |
