import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import type { FastifyBaseLogger } from 'fastify'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function contactsRef(firestore: Firestore, tenantId: string, contactId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('contacts').doc(contactId)
}

function messagesRef(firestore: Firestore, tenantId: string, contactId: string, messageId: string) {
  return contactsRef(firestore, tenantId, contactId).collection('messages').doc(messageId)
}

function appointmentsRef(firestore: Firestore, tenantId: string, appointmentId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('appointments').doc(appointmentId)
}

function chargesRef(firestore: Firestore, tenantId: string, chargeId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('charges').doc(chargeId)
}

// ─── FirebaseSyncService ──────────────────────────────────────────────────────

export class FirebaseSyncService {
  constructor(
    private firestore: Firestore | null,
    private logger?: FastifyBaseLogger,
  ) {}

  private handleError(operation: string, err: unknown) {
    this.logger?.error({ err }, `firebase-sync:${operation}:error`)
  }

  private get isEnabled(): boolean {
    return this.firestore !== null
  }

  // ── Contact ────────────────────────────────────────────────────────────────

  async syncContact(
    tenantId: string,
    contact: {
      id: string
      phone: string
      name: string | null
      email: string | null
      status: string
      currentStageId: string | null
      currentFunnelId: string | null
      lastMessageAt: Date | null
      assignedProfessionalId: string | null
    },
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await contactsRef(this.firestore!, tenantId, contact.id).set(
        {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          email: contact.email,
          status: contact.status,
          stageId: contact.currentStageId,
          funnelId: contact.currentFunnelId,
          lastMessageAt: contact.lastMessageAt,
          assignedProfessionalId: contact.assignedProfessionalId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('syncContact', err)
    }
  }

  // ── Conversation message + preview (batch write) ────────────────────────────

  async syncConversationMessage(
    tenantId: string,
    contactId: string,
    message: {
      id: string
      role: string
      type: string
      content: string
      createdAt: Date
      metadata?: Record<string, unknown> | null
    },
    contactMeta?: {
      name: string | null
      phone: string
      status: string
      photoUrl?: string | null
    },
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      const batch = this.firestore!.batch()

      // 1. Message document
      batch.set(messagesRef(this.firestore!, tenantId, contactId, message.id), {
        id: message.id,
        role: message.role,
        type: message.type,
        content: message.content,
        createdAt: message.createdAt,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      })

      // 2. Conversation preview (top-level contact doc update)
      const preview = message.content.slice(0, 100)
      const contactDocRef = contactsRef(this.firestore!, tenantId, contactId)

      const previewUpdate: Record<string, unknown> = {
        lastMessage: preview,
        lastMessageAt: message.createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      }

      if (message.role === 'CONTACT') {
        previewUpdate['unreadCount'] = FieldValue.increment(1)
      }

      if (contactMeta) {
        previewUpdate['contactName'] = contactMeta.name
        previewUpdate['contactPhone'] = contactMeta.phone
        previewUpdate['status'] = contactMeta.status
        if (contactMeta.photoUrl) {
          previewUpdate['photoUrl'] = contactMeta.photoUrl
        }
      }

      batch.set(contactDocRef, previewUpdate, { merge: true })

      await batch.commit()
    } catch (err) {
      this.handleError('syncConversationMessage', err)
    }
  }

  // Legacy alias kept for existing callers
  async syncMessage(params: {
    tenantId: string
    contactId: string
    messageId: string
    role: string
    type: string
    content: string
    createdAt: Date
  }): Promise<void> {
    return this.syncConversationMessage(params.tenantId, params.contactId, {
      id: params.messageId,
      role: params.role,
      type: params.type,
      content: params.content,
      createdAt: params.createdAt,
    })
  }

  // Legacy alias kept for existing callers
  async updateContactPresence(params: {
    tenantId: string
    contactId: string
    status: string
    stageId: string | null
    lastMessageAt: Date | null
  }): Promise<void> {
    if (!this.isEnabled) return
    try {
      await contactsRef(this.firestore!, params.tenantId, params.contactId).set(
        {
          status: params.status,
          stageId: params.stageId,
          lastMessageAt: params.lastMessageAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('updateContactPresence', err)
    }
  }

  // ── Appointment ────────────────────────────────────────────────────────────

  async syncAppointment(
    tenantId: string,
    appointment: {
      id: string
      contactId: string
      professionalId: string
      serviceId: string
      scheduledAt: Date
      durationMin: number
      status: string
      notes: string | null
    },
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await appointmentsRef(this.firestore!, tenantId, appointment.id).set(
        {
          ...appointment,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('syncAppointment', err)
    }
  }

  // ── Charge ─────────────────────────────────────────────────────────────────

  async syncCharge(
    tenantId: string,
    charge: {
      id: string
      contactId: string
      amount: unknown
      description: string
      status: string
      pixCopyPaste: string | null
      dueAt: Date | null
      paidAt: Date | null
    },
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await chargesRef(this.firestore!, tenantId, charge.id).set(
        {
          ...charge,
          amount: String(charge.amount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('syncCharge', err)
    }
  }

  // ── Agent typing indicator ─────────────────────────────────────────────────

  async setAgentTyping(
    tenantId: string,
    contactId: string,
    isTyping: boolean,
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await contactsRef(this.firestore!, tenantId, contactId).set(
        {
          agentTyping: isTyping,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('setAgentTyping', err)
    }
  }

  // ── Mark messages read ─────────────────────────────────────────────────────

  async markMessagesRead(tenantId: string, contactId: string): Promise<void> {
    if (!this.isEnabled) return
    try {
      await contactsRef(this.firestore!, tenantId, contactId).set(
        { unreadCount: 0, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    } catch (err) {
      this.handleError('markMessagesRead', err)
    }
  }

  // ── Message status (READ, RECEIVED, PLAYED) ──────────────────────────────

  async updateMessageStatus(
    tenantId: string,
    contactId: string,
    messageId: string,
    status: string,
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await messagesRef(this.firestore!, tenantId, contactId, messageId).set(
        { status, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    } catch (err) {
      this.handleError('updateMessageStatus', err)
    }
  }

  // ── Contact typing indicator (from WhatsApp) ─────────────────────────────

  async setContactTyping(
    tenantId: string,
    contactId: string,
    isTyping: boolean,
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await contactsRef(this.firestore!, tenantId, contactId).set(
        {
          contactTyping: isTyping,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('setContactTyping', err)
    }
  }

  // ── Instance connection status ────────────────────────────────────────────

  async syncInstanceStatus(
    tenantId: string,
    connected: boolean,
    error?: string,
  ): Promise<void> {
    if (!this.isEnabled) return
    try {
      await this.firestore!.collection('tenants').doc(tenantId).set(
        {
          whatsappConnected: connected,
          ...(error ? { whatsappError: error } : {}),
          whatsappStatusAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch (err) {
      this.handleError('syncInstanceStatus', err)
    }
  }
}
