import { Type } from '@sinclair/typebox'

export const ContactParamsSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
})

export const SendMessageSchema = Type.Object({
  type: Type.Union([
    Type.Literal('TEXT'),
    Type.Literal('IMAGE'),
    Type.Literal('AUDIO'),
    Type.Literal('VIDEO'),
    Type.Literal('DOCUMENT'),
    Type.Literal('STICKER'),
    Type.Literal('LOCATION'),
    Type.Literal('CONTACT'),
    Type.Literal('REACTION'),
  ]),

  // TEXT
  text: Type.Optional(Type.String({ minLength: 1 })),

  // IMAGE / AUDIO / VIDEO / DOCUMENT / STICKER — URL ou base64
  mediaUrl: Type.Optional(Type.String({ minLength: 1 })),
  caption: Type.Optional(Type.String()),
  fileName: Type.Optional(Type.String()),

  // LOCATION
  latitude: Type.Optional(Type.String()),
  longitude: Type.Optional(Type.String()),
  locationTitle: Type.Optional(Type.String()),
  locationAddress: Type.Optional(Type.String()),

  // CONTACT
  contactName: Type.Optional(Type.String()),
  contactPhone: Type.Optional(Type.String()),

  // REACTION
  reaction: Type.Optional(Type.String()),
  replyToZapiMessageId: Type.Optional(Type.String()),
})

export const ListMessagesQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  before: Type.Optional(Type.String()),
})
