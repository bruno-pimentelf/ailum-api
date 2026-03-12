/**
 * Shared template interpolation for message templates.
 * Variables: {{name}}, {{appointmentTime}}, {{appointmentDate}}, {{appointmentTimeOnly}},
 * {{professionalName}}, {{serviceName}}
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}
