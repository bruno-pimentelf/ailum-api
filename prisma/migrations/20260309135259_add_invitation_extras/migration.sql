-- CreateTable
CREATE TABLE "invitation_extras" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invitationId" TEXT NOT NULL,
    "professionalId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_extras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_extras_invitationId_key" ON "invitation_extras"("invitationId");
