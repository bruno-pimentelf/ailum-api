# Disponibilidade — Cheatsheet Frontend

> APIs em `/v1/professionals`, `/v1/scheduling`, `/v1/ailum-ai` | Auth: cookies | HH:mm em incrementos de 5 min (00, 05, 10…)

---

## APIs

| Método | Rota | O que faz |
|--------|------|-----------|
| GET | `/professionals` | Lista profissionais |
| GET | `/professionals/:id` | Detalhe + availability, exceptions, overrides, blockRanges |
| GET | `/professionals/:id/availability` | Grade semanal (recorrente) |
| PUT | `/professionals/:id/availability` | Define grade semanal (substitui tudo) |
| DELETE | `/professionals/:id/availability` | Limpa toda a disponibilidade (grade + exceções + overrides + block ranges). Não altera appointments. |
| POST | `/professionals/:id/exceptions` | Bloqueia dia ou parte dele |
| DELETE | `/professionals/:id/exceptions/:date` | Remove exceção |
| POST | `/professionals/:id/overrides` | Adiciona horário em data específica |
| GET | `/professionals/:id/overrides?from=&to=` | Lista overrides |
| DELETE | `/professionals/:id/overrides/:overrideId` | Remove override |
| POST | `/professionals/:id/block-ranges` | Bloqueia intervalo (férias) |
| GET | `/professionals/:id/block-ranges` | Lista block ranges |
| DELETE | `/professionals/:id/block-ranges/:id` | Remove block range |
| GET | `/scheduling/professionals/:id/availability?date=&serviceId=` | Slots livres para agendar |
| POST | `/ailum-ai/availability` | Linguagem natural → altera disponibilidade |

---

## Permissões

| Role | Leitura | Editar |
|------|---------|--------|
| ADMIN | ✅ | Qualquer profissional |
| PROFESSIONAL | ✅ | Só o próprio (linked) |
| SECRETARY | ✅ | ❌ |

---

## Prioridade por data

1. **Exceção isUnavailable=true** → dia inteiro bloqueado
2. **Block range** (dateFrom ≤ data ≤ dateTo) → dia bloqueado
3. **Merge(grade semanal + overrides)** → janelas de horário (sobreposições fundidas)
4. **slotMask** (exceção isUnavailable=false) → remove janelas da grade (bloqueio parcial)

`dayOfWeek`: 0=dom, 1=seg … 6=sáb.

---

## Fluxos

| Fluxo | APIs |
|-------|------|
| Grade semanal | PUT availability (array, substitui) |
| Limpar toda disponibilidade | DELETE availability |
| Bloquear dia | POST exceptions `{date, isUnavailable: true}` |
| Bloquear parte do dia | POST exceptions `{date, isUnavailable: false, slotMask: [{startTime, endTime}]}` |
| Férias / intervalo | POST block-ranges `{dateFrom, dateTo}` |
| Horário extra em data | POST overrides `{date, startTime, endTime}` |
| Desbloquear dia | DELETE exceptions/:date |
| Remover override | DELETE overrides/:overrideId |
| Remover férias | DELETE block-ranges/:id |
| Slots para agendar | GET scheduling/.../availability?date=&serviceId= |
| Linguagem natural | POST ailum-ai/availability `{message, professionalId?}` |

---

## Corner cases

| Caso | Comportamento |
|------|---------------|
| **Override + grade no mesmo dia** | Merge: ambos usados, janelas sobrepostas fundidas |
| **Vários overrides no mesmo dia** | Merge: todos fundidos |
| **slotMask** | Só com `isUnavailable: false`; remove janelas da grade |
| **dateTo < dateFrom** (block-range) | Erro 400 |
| **Horários inválidos** | HH:mm em 5 min; endTime deve ser > startTime |
| **Array vazio** (PUT availability) | Remove toda a grade |
| **Ailum AI: "amanhã"** | Timezone Brasil (America/Sao_Paulo) |
| **remove_override** (Ailum AI) | Por data — remove primeiro override da data |
| **remove_block_range** (Ailum AI) | Por dateFrom+dateTo — remove bloco exato |
| **Profissional sem grade** | Override sozinho define o dia |
| **Dia sem grade nem override** | Indisponível (exceto se exception parcial) |
| **Appointments existentes** | Slots já ocupados não retornam em scheduling |
| **Ailum AI rate limit** | 20 req/min por IP |
| **Override duplicado** | Retorna o existente (mesma data + startTime + endTime) |
| **Exception duplicada** | Retorna o existente (mesma data + isUnavailable + slotMask) |
| **Block range duplicado** | Retorna o existente (mesmo dateFrom + dateTo) |

---

## Bodies resumidos

**PUT availability:** `[{dayOfWeek, startTime, endTime, slotDurationMin?}]`

**POST exceptions:** `{date, isUnavailable?, reason?, slotMask?}` — slotMask: `[{startTime, endTime}]`

**POST overrides:** `{date, startTime, endTime, slotDurationMin?}`

**POST block-ranges:** `{dateFrom, dateTo, reason?}`

**POST ailum-ai/availability:** `{message, professionalId?}`
