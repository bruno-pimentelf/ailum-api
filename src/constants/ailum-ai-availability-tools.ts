import { Type } from '@sinclair/typebox'

export interface AilumAIAvailabilityTool {
  name: string
  description: string
  input_schema: ReturnType<typeof Type.Object>
}

const timePattern = Type.String({
  pattern: '^([01]\\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$',
  description: 'HH:mm em incrementos de 5 min',
})
const datePattern = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'YYYY-MM-DD',
})

export const AILUM_AI_AVAILABILITY_TOOLS = {
  set_weekly_availability: {
    name: 'set_weekly_availability',
    description: `Define a grade semanal de disponibilidade (substitui a atual).
Ex: "toda segunda e quarta 9h às 18h" → slots com dayOfWeek (0=dom, 1=seg...6=sáb), startTime, endTime.`,
    input_schema: Type.Object({
      slots: Type.Array(
        Type.Object({
          dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
          startTime: timePattern,
          endTime: timePattern,
          slotDurationMin: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
        }),
      ),
    }),
  },

  block_day: {
    name: 'block_day',
    description: 'Bloqueia um dia específico (ex: "amanhã não posso", "dia 25 não tenho").',
    input_schema: Type.Object({
      date: datePattern,
      reason: Type.Optional(Type.String()),
    }),
  },

  block_date_range: {
    name: 'block_date_range',
    description: 'Bloqueia um intervalo de datas (ex: "férias 01/04 a 15/04", "próxima semana inteira não tenho").',
    input_schema: Type.Object({
      dateFrom: datePattern,
      dateTo: datePattern,
      reason: Type.Optional(Type.String()),
    }),
  },

  add_specific_day: {
    name: 'add_specific_day',
    description: 'Adiciona disponibilidade em data específica (ex: "sábado 15/03 tenho 9h às 12h").',
    input_schema: Type.Object({
      date: datePattern,
      startTime: timePattern,
      endTime: timePattern,
      slotDurationMin: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
    }),
  },

  block_partial_day: {
    name: 'block_partial_day',
    description: 'Bloqueia apenas parte do dia (ex: "segunda 11/03 só à tarde", "de manhã tenho reunião"). slotMask remove janelas da grade semanal.',
    input_schema: Type.Object({
      date: datePattern,
      slotMask: Type.Array(
        Type.Object({
          startTime: timePattern,
          endTime: timePattern,
        }),
      ),
    }),
  },

  remove_exception: {
    name: 'remove_exception',
    description: 'Remove bloqueio de um dia específico (desfaz block_day para aquela data).',
    input_schema: Type.Object({
      date: datePattern,
    }),
  },

  remove_block_range: {
    name: 'remove_block_range',
    description: 'Remove bloqueio de intervalo. Use dateFrom e dateTo para identificar o bloco a remover.',
    input_schema: Type.Object({
      dateFrom: datePattern,
      dateTo: datePattern,
    }),
  },

  remove_override: {
    name: 'remove_override',
    description: 'Remove disponibilidade em data específica. Use a data do override.',
    input_schema: Type.Object({
      date: datePattern,
    }),
  },
} as const satisfies Record<string, AilumAIAvailabilityTool>

export type AilumAIAvailabilityToolName = keyof typeof AILUM_AI_AVAILABILITY_TOOLS
