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

export const SetAvailabilitySchema = Type.Array(
  Type.Object({
    dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
    startTime: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    endTime: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    slotDurationMin: Type.Optional(Type.Integer({ minimum: 5, default: 50 })),
  }),
)

export const AddExceptionSchema = Type.Object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  isUnavailable: Type.Optional(Type.Boolean({ default: true })),
  reason: Type.Optional(Type.String()),
})

export const AssociateServiceSchema = Type.Object({
  customPrice: Type.Optional(Type.Number({ minimum: 0 })),
})
