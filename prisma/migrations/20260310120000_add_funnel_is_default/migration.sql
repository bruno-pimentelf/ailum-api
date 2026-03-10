-- Add isDefault to Funnel (funil de entrada para novos contatos)
ALTER TABLE "funnels" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Marca o primeiro funil de cada tenant como padrão (para tenants existentes)
WITH first_per_tenant AS (
  SELECT DISTINCT ON ("tenantId") id
  FROM "funnels"
  WHERE "isActive" = true
  ORDER BY "tenantId", "order" ASC, "createdAt" ASC
)
UPDATE "funnels"
SET "isDefault" = true
WHERE id IN (SELECT id FROM first_per_tenant);
