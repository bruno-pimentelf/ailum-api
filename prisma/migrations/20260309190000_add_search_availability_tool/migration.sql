-- Add search_availability to allowedTools for stages that have create_appointment
-- (so agent can fetch availability by date when user says "amanhã", etc.)
UPDATE stage_agent_configs sac
SET "allowedTools" = array_prepend('search_availability', sac."allowedTools")
WHERE 'create_appointment' = ANY(sac."allowedTools")
  AND NOT ('search_availability' = ANY(sac."allowedTools"));
