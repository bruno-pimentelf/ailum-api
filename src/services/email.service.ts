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
      from: 'Ailum <noreply@ailum.io>',
      to: params.to,
      subject: `Você foi convidado para ${params.organizationName}`,
      html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Convite Ailum</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Arial,sans-serif;background-color:#0f1115;color:#e4e6eb;-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#0f1115;min-height:100vh;">
    <tr>
      <td align="center" style="padding:48px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:420px;background:#16191f;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding:40px 32px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="font-size:14px;font-weight:700;letter-spacing:0.35em;color:#e4e6eb;">A I L U M</span>
              <div style="width:48px;height:48px;margin:20px auto 0;background:rgba(45,212,223,0.12);border:1px solid rgba(45,212,223,0.3);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                <span style="font-size:24px;color:#2dd4df;">✉</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#f0f2f5;">Você foi convidado</h2>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:rgba(228,230,235,0.75);">
                <strong style="color:#e4e6eb;">${params.inviterName}</strong> convidou você para participar da clínica <strong style="color:#e4e6eb;">${params.organizationName}</strong> no Ailum.
              </p>
              <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:rgba(228,230,235,0.65);">
                Gerencie agendamentos, atendimentos e pagamentos integrados em um só lugar.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${params.inviteLink}" style="display:inline-block;padding:14px 28px;background-color:#2dd4df;color:#0a0c10;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;border:none;">
                      Aceitar convite →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;font-size:12px;color:rgba(228,230,235,0.4);">O link expira em 48 horas.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:12px;color:rgba(228,230,235,0.35);">Se você não esperava este convite, ignore este e-mail.</p>
              <p style="margin:8px 0 0;font-size:11px;color:rgba(228,230,235,0.25);">Ailum · Agendamento com IA</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend API error ${response.status}: ${body}`)
  }
}
