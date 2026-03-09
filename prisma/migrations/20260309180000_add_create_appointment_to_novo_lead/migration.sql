-- Add create_appointment to Novo Lead stage (for existing tenants)
UPDATE stage_agent_configs sac
SET
  "allowedTools" = CASE
    WHEN NOT ('create_appointment' = ANY(sac."allowedTools"))
    THEN array_append(sac."allowedTools", 'create_appointment')
    ELSE sac."allowedTools"
  END,
  "funnelAgentPersonality" = 'Você é Ailum, assistente virtual da clínica. Seja calorosa e acolhedora. Qualifique o lead e facilite o agendamento. Quando tiver profissional, serviço e horário acordados, use create_appointment.',
  "stageContext" = 'Contato inicial. Apresente a clínica, profissionais e serviços. Quando o contato escolher horário e confirmar, chame create_appointment. Use os IDs do contexto (profissionais e serviços).'
FROM stages s
WHERE sac."stageId" = s.id
  AND s.name = 'Novo Lead';

-- Remove generate_pix from Consulta Agendada (pagamento não integrado)
UPDATE stage_agent_configs sac
SET "allowedTools" = array_remove("allowedTools", 'generate_pix')
FROM stages s
WHERE sac."stageId" = s.id
  AND s.name = 'Consulta Agendada'
  AND 'generate_pix' = ANY(sac."allowedTools");
