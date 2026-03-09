# Tenant API — Referência Rápida

Base: `/v1/tenant` | Auth: `Bearer <session_token>`

---

## GET /v1/tenant

Qualquer membro autenticado.

**Resposta:**
```json
{
  "id": "uuid",
  "name": "Clínica Harmonia",
  "slug": "clinica-harmonia",
  "plan": "starter",
  "isAgentEnabledForWhatsApp": false,
  "logoUrl": null,
  "description": null,
  "phone": null,
  "email": null,
  "website": null,
  "addressStreet": null,
  "addressNumber": null,
  "addressComplement": null,
  "addressNeighborhood": null,
  "addressCity": null,
  "addressState": null,
  "addressZip": null,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

## PATCH /v1/tenant

Requer **ADMIN**. Todos os campos são opcionais.

**Body:**
```json
{
  "name": "Clínica Harmonia",
  "isAgentEnabledForWhatsApp": true,
  "description": "Clínica especializada em saúde integrativa.",
  "phone": "(11) 3456-7890",
  "email": "contato@clinica.com",
  "website": "https://clinica.com",
  "logoUrl": "https://storage.googleapis.com/...",
  "addressStreet": "Rua das Flores",
  "addressNumber": "123",
  "addressComplement": "Sala 201",
  "addressNeighborhood": "Centro",
  "addressCity": "São Paulo",
  "addressState": "SP",
  "addressZip": "01310-100"
}
```

Retorna o tenant atualizado com os mesmos campos do GET.
