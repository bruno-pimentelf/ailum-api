# Members API — Referência Rápida

Base: `/v1/members` | Auth: `Bearer <session_token>` em todas as rotas.

---

## Rotas

```
GET    /v1/members              → lista membros ativos com roles
POST   /v1/members/invite       → convida por email
PATCH  /v1/members/:id/role     → altera role / profissional vinculado
DELETE /v1/members/:id          → remove membro (soft delete)
```

---

## GET /v1/members

```ts
[{
  id: string                  // memberId
  userId: string
  role: "ADMIN" | "PROFESSIONAL" | "SECRETARY"
  isActive: boolean
  joinedAt: Date
  professional: {             // null se não vinculado
    id: string
    fullName: string
    specialty: string | null
  } | null
}]
```

---

## POST /v1/members/invite

Usa o fluxo de convite do Better Auth: envia email via Resend, cria invitation. O usuário recebe link `{WEB_URL}/invite/{invitationId}`.

```json
{
  "email": "joao@clinica.com",
  "role": "PROFESSIONAL",
  "professionalId": "uuid-opcional"
}
```

**Resposta (201):** `{ id, email, role, status: "pending" }` (id = invitationId)

**Fluxo no front:** Página `/invite/[id]` — usuário faz login ou sign up com o mesmo email, depois chama `authClient.organization.acceptInvitation({ invitationId: id })`. Ao aceitar, o backend cria o TenantMember automaticamente via hook.

---

## PATCH /v1/members/:id/role

```json
{
  "role": "SECRETARY",
  "professionalId": "uuid-ou-null"
}
```

Ambos os campos são opcionais.

---

## Perfil do usuário logado

```
GET /v1/auth/me
```

```ts
{
  id: string
  name: string | null
  email: string | null
  image: string | null
  createdAt: string
  memberId: string
  role: "ADMIN" | "PROFESSIONAL" | "SECRETARY"
  professionalId: string | null
  tenant: { id: string; name: string; slug: string }
}
```
