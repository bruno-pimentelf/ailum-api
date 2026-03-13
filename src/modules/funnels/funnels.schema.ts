import { Type } from '@sinclair/typebox'

export const FunnelParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })
export const StageParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })
export const TriggerParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const CreateFunnelSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  order: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
})

export const UpdateFunnelSchema = Type.Partial(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    description: Type.String(),
    order: Type.Integer({ minimum: 0 }),
    isDefault: Type.Boolean(),
  }),
)

export const CreateStageSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  color: Type.Optional(Type.String({ default: '#64748b' })),
  order: Type.Integer({ minimum: 0 }),
  isTerminal: Type.Optional(Type.Boolean({ default: false })),
})

export const UpdateStageSchema = Type.Partial(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    color: Type.String(),
    order: Type.Integer({ minimum: 0 }),
    isTerminal: Type.Boolean(),
  }),
)

export const UpsertAgentConfigSchema = Type.Object({
  funnelAgentName: Type.Optional(Type.String()),
  funnelAgentPersonality: Type.Optional(Type.String()),
  stageContext: Type.Optional(Type.String()),
  allowedTools: Type.Optional(Type.Array(Type.String())),
  requirePaymentBeforeConfirm: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.Union([Type.Literal('HAIKU'), Type.Literal('SONNET')])),
  temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
})

export const CreateTriggerSchema = Type.Object({
  event: Type.Union([
    Type.Literal('STAGE_ENTERED'),
    Type.Literal('STALE_IN_STAGE'),
    Type.Literal('PAYMENT_CONFIRMED'),
    Type.Literal('APPOINTMENT_APPROACHING'),
    Type.Literal('AI_INTENT'),
    Type.Literal('MESSAGE_RECEIVED'),
  ]),
  action: Type.Union([
    Type.Literal('SEND_MESSAGE'),
    Type.Literal('MOVE_STAGE'),
    Type.Literal('GENERATE_PIX'),
    Type.Literal('NOTIFY_OPERATOR'),
    Type.Literal('WAIT_AND_REPEAT'),
  ]),
  actionConfig: Type.Record(Type.String(), Type.Unknown()),
  conditionConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  delayMinutes: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  cooldownSeconds: Type.Optional(Type.Integer({ minimum: 0, default: 3600 })),
})

export const UpdateTriggerSchema = Type.Partial(CreateTriggerSchema)

export const BoardQuerySchema = Type.Object({
  search: Type.Optional(Type.String()),
  assignedProfessionalId: Type.Optional(Type.String({ format: 'uuid' })),
})
