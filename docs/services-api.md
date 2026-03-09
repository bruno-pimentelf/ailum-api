# Services API — Referência Rápida

Base: `/v1/services` | Auth: `Bearer <session_token>` em todas as rotas.

---

## Rotas

```
GET    /v1/services        → lista serviços ativos
GET    /v1/services/:id    → detalhe
POST   /v1/services        → cria
PATCH  /v1/services/:id    → edita
DELETE /v1/services/:id    → desativa (soft delete)
```

---

## POST / PATCH body

```json
{
  "name": "Consulta",
  "description": "Consulta inicial",
  "durationMin": 50,
  "price": 250.00
}
```

`name` e `price` são obrigatórios no POST. No PATCH todos são opcionais.

---

## Resposta (GET)

```ts
{
  id: string
  name: string
  description: string | null
  durationMin: number        // duração em minutos (padrão: 50)
  price: number
  isActive: boolean
  createdAt: string
}
```
