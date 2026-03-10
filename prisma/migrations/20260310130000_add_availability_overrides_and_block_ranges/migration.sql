-- CreateTable
CREATE TABLE "availability_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "professionalId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotDurationMin" INTEGER NOT NULL DEFAULT 50,

    CONSTRAINT "availability_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_block_ranges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "professionalId" UUID NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "availability_block_ranges_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_block_ranges" ADD CONSTRAINT "availability_block_ranges_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
