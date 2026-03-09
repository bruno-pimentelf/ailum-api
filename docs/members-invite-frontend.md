# Convite — Frontend

## Endpoints

### GET `/v1/members`
**Response 200**
```json
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "userId": "string",
    "role": "ADMIN" | "PROFESSIONAL" | "SECRETARY",
    "professionalId": "uuid" | null,
    "isActive": true,
    "joinedAt": "ISO8601",
    "createdAt": "ISO8601",
    "professional": { "id": "uuid", "fullName": "string", "specialty": "string" } | null,
    "user": { "id": "string", "name": "string", "email": "string", "image": "string" } | null
  }
]
```

### GET `/v1/members/invitations`
**Response 200**
```json
[
  {
    "id": "string",
    "email": "string",
    "role": "ADMIN" | "PROFESSIONAL" | "SECRETARY" | "Membro",
    "status": "pending" | "accepted" | "expired",
    "expiresAt": "ISO8601",
    "createdAt": "ISO8601"
  }
]
```

### POST `/v1/members/invite`
**Body**
```json
{ "email": "string", "role": "ADMIN" | "PROFESSIONAL" | "SECRETARY", "professionalId": "uuid" }
```
**Response 201**
```json
{ "id": "string", "email": "string", "role": "string", "status": "pending" }
```

### PATCH `/v1/members/:id/role`
**Body**
```json
{ "role": "ADMIN" | "PROFESSIONAL" | "SECRETARY", "professionalId": "uuid" }
```
**Response 200** — objeto `tenantMember` completo

### DELETE `/v1/members/:id`
**Response 200** — objeto `tenantMember` (isActive: false)

## Página de membros

- Listar membros: `GET /v1/members`
- Listar convites: `GET /v1/members/invitations` — exibir email, role, status

## Página `/invite/[id]`

- Link: `{WEB_URL}/invite/{id}?email={email}`
- Não logado → login/signup com `callbackUrl=/invite/[id]` e `email` no signup
- Logado → `authClient.organization.acceptInvitation({ invitationId })` → redirecionar
- Logado com outro email → avisar

## Auth

```ts
createAuthClient({ plugins: [organizationClient()] })
```
