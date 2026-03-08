import { Type } from '@sinclair/typebox'

export const MemberParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const InviteMemberSchema = Type.Object({
  email: Type.String({ format: 'email' }),
  role: Type.Union([Type.Literal('ADMIN'), Type.Literal('PROFESSIONAL'), Type.Literal('SECRETARY')]),
  professionalId: Type.Optional(Type.String({ format: 'uuid' })),
})

export const UpdateMemberSchema = Type.Object({
  role: Type.Optional(
    Type.Union([Type.Literal('ADMIN'), Type.Literal('PROFESSIONAL'), Type.Literal('SECRETARY')]),
  ),
  professionalId: Type.Optional(Type.String({ format: 'uuid' })),
  isActive: Type.Optional(Type.Boolean()),
})
