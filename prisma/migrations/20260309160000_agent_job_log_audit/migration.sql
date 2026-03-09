-- AlterTable
ALTER TABLE "agent_job_logs" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'REPLIED',
ADD COLUMN "auditDetails" JSONB;

UPDATE "agent_job_logs" SET "status" = 'ERROR' WHERE "error" IS NOT NULL;
