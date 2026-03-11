# Perfil Público da Clínica

> Endpoint público — **sem autenticação**

## `GET /v1/public/clinics/:slug`

Retorna o perfil da clínica para landing pública, páginas de agendamento, etc.

**Exemplo:** `GET /v1/public/clinics/clinica-harmonia`

### Resposta 200

```json
{
  "id": "uuid",
  "name": "Clínica Harmonia",
  "slug": "clinica-harmonia",
  "description": "Descrição da clínica",
  "logoUrl": "https://...",
  "phone": "(11) 99999-9999",
  "email": "contato@clinica.com",
  "website": "https://clinica.com",
  "address": {
    "street": "Rua das Flores",
    "number": "123",
    "complement": "Sala 2",
    "neighborhood": "Centro",
    "city": "São Paulo",
    "state": "SP",
    "zip": "01234-567"
  },
  "services": [
    {
      "id": "uuid",
      "name": "Consulta de rotina",
      "description": "...",
      "durationMin": 50,
      "price": 150,
      "isConsultation": true,
      "professionals": [
        { "id": "uuid", "fullName": "Dr. João", "specialty": "Clínico geral", "avatarUrl": "..." }
      ]
    }
  ],
  "professionals": [
    {
      "id": "uuid",
      "fullName": "Dr. João",
      "specialty": "Clínico geral",
      "bio": "...",
      "avatarUrl": "...",
      "services": [{ "id": "uuid", "name": "Consulta de rotina" }]
    }
  ]
}
```

### Resposta 404

Clínica não encontrada ou inativa.

```json
{ "error": "Clínica não encontrada" }
```
