import { env } from '../config/env.js'

export interface SendInvitationEmailParams {
  to: string
  inviterName: string
  organizationName: string
  inviteLink: string
}

export async function sendInvitationEmail(params: SendInvitationEmailParams): Promise<void> {
  const response = await globalThis.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Ailum <noreply@ailum.com.br>',
      to: params.to,
      subject: `Você foi convidado para ${params.organizationName}`,
      html: `
        <h2>Convite para ${params.organizationName}</h2>
        <p>${params.inviterName} convidou você para participar da clínica <strong>${params.organizationName}</strong> no Ailum.</p>
        <p><a href="${params.inviteLink}" style="padding: 12px 24px; background: #3b82f6; color: white; border-radius: 6px; text-decoration: none;">
          Aceitar convite
        </a></p>
        <p>O link expira em 48 horas.</p>
      `,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend API error ${response.status}: ${body}`)
  }
}
