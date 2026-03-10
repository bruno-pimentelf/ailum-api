import { Type } from '@sinclair/typebox'

export const ProfessionalParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const ExceptionDateParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
})

export const ServiceAssocParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  serviceId: Type.String({ format: 'uuid' }),
})

export const CreateProfessionalSchema = Type.Object({
  fullName: Type.String({ minLength: 1 }),
  specialty: Type.Optional(Type.String()),
  bio: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Type.String({ format: 'uri' })),
  voiceId: Type.Optional(Type.String({ format: 'uuid' })),
  calendarColor: Type.Optional(Type.String({ default: '#3b82f6' })),
})

export const UpdateProfessionalSchema = Type.Partial(CreateProfessionalSchema)

// Horários em incrementos de 5 min
export const SetAvailabilitySchema = Type.Array(
  Type.Object({
    dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
    startTime: Type.String({ pattern: '^([01]\\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$' }),
    endTime: Type.String({ pattern: '^([01]\\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$' }),
    slotDurationMin: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
  }),
)

// Horários em incrementos de 5 min
const TimePattern = Type.String({ pattern: '^([01]\\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$' })

export const AddExceptionSchema = Type.Object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  isUnavailable: Type.Optional(Type.Boolean({ default: true })),
  reason: Type.Optional(Type.String()),
  /** Quando isUnavailable=false: janelas a remover da grade semanal (bloqueios parciais). */
  slotMask: Type.Optional(
    Type.Array(
      Type.Object({
        startTime: TimePattern,
        endTime: TimePattern,
      }),
    ),
  ),
})

export const AddOverrideSchema = Type.Object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  startTime: TimePattern,
  endTime: TimePattern,
  slotDurationMin: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
})

export const AddBlockRangeSchema = Type.Object({
  dateFrom: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  dateTo: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  reason: Type.Optional(Type.String()),
})

export const OverrideIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  overrideId: Type.String({ format: 'uuid' }),
})

export const BlockRangeIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  blockRangeId: Type.String({ format: 'uuid' }),
})

export const AssociateServiceSchema = Type.Object({
  customPrice: Type.Optional(Type.Number({ minimum: 0 })),
})
