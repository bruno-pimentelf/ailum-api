-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "zapiChatLid" TEXT;

-- CreateIndex
CREATE INDEX "contacts_tenantId_zapiChatLid_idx" ON "contacts"("tenantId", "zapiChatLid");
