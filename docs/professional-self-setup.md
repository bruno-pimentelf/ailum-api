# Profissional — Criar e vincular a si mesmo

Se "Minha Disponibilidade" fica carregando infinito, provavelmente seu `member.professionalId` está `null`. Esta doc explica como criar um profissional e vincular ao seu membro.

---

## Conceito

- **Professional** e **Member** são entidades distintas
- **Professional** = cadastro de quem atende (nome, especialidade, disponibilidade)
- **Member** = quem usa o sistema (login, role)
- O **Member** pode ser vinculado a um **Professional** via `member.professionalId`

"Minha Disponibilidade" precisa de um profissional vinculado ao seu membro. Se `professionalId` for `null`, a tela fica em loading infinito (o front chama algo como `GET /professionals/null/availability` ou espera um id que nunca vem).

---

## Como criar profissional e vincular a si mesmo

### 1. Criar o profissional (requer ADMIN)

```
POST /v1/professionals
Content-Type: application/json

{
  "fullName": "Seu Nome",
  "specialty": "Sua especialidade",
  "calendarColor": "#3b82f6"
}
```

**Resposta:** objeto com `id` (UUID) do profissional criado. Guarde esse `id`.

---

### 2. Vincular o profissional ao seu membro

Obtenha seu `memberId` em `GET /v1/auth/me` (ou em `GET /v1/members`).

```
PATCH /v1/members/{memberId}/role
Content-Type: application/json

{
  "professionalId": "uuid-do-profissional-criado-no-passo-1"
}
```

Você pode manter o `role` atual (ex.: ADMIN) e só enviar `professionalId`.

---

### 3. Conferir

Chame `GET /v1/auth/me` novamente. O campo `professionalId` deve vir preenchido. A partir daí "Minha Disponibilidade" deve carregar normalmente.

---

## Resumo

1. **POST /v1/professionals** — cria o profissional (qualquer ADMIN faz isso)
2. **PATCH /v1/members/:id/role** — vincula o profissional ao seu member

Não precisa ser "membro" de outra forma: você cria o profissional e associa ao seu próprio member.

---

## Sugestão de UX no frontend

Se `GET /v1/auth/me` retornar `professionalId: null`, não manter loading infinito. Exibir mensagem tipo: *"Você ainda não tem um profissional vinculado. Entre em contato com o administrador."* ou, se for ADMIN, um fluxo "Criar meu perfil profissional" que faça os dois passos acima.
