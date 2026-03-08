import { Type } from '@sinclair/typebox'

export const AppointmentParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const ListAppointmentsQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  professionalId: Type.Optional(Type.String({ format: 'uuid' })),
  status: Type.Optional(Type.String()),
  from: Type.Optional(Type.String({ format: 'date' })),
  to: Type.Optional(Type.String({ format: 'date' })),
  contactId: Type.Optional(Type.String({ format: 'uuid' })),
})

export const CreateAppointmentSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
  professionalId: Type.String({ format: 'uuid' }),
  serviceId: Type.String({ format: 'uuid' }),
  scheduledAt: Type.String({ format: 'date-time' }),
  durationMin: Type.Optional(Type.Integer({ minimum: 5 })),
  notes: Type.Optional(Type.String()),
})

export const UpdateAppointmentSchema = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('PENDING'),
      Type.Literal('CONFIRMED'),
      Type.Literal('CANCELLED'),
      Type.Literal('COMPLETED'),
      Type.Literal('NO_SHOW'),
    ]),
  ),
  scheduledAt: Type.Optional(Type.String({ format: 'date-time' })),
  notes: Type.Optional(Type.String()),
  cancelledReason: Type.Optional(Type.String()),
})

export const AvailabilityQuerySchema = Type.Object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' }),
  serviceId: Type.String({ format: 'uuid' }),
})

export const ProfessionalAvailabilityParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})
