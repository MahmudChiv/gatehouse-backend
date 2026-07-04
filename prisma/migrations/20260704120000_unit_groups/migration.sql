-- CreateTable
CREATE TABLE "unit_groups" (
    "id" UUID NOT NULL,
    "estateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_groups_estateId_idx" ON "unit_groups"("estateId");

-- AlterTable
ALTER TABLE "units" ADD COLUMN "groupId" UUID;

-- CreateIndex
CREATE INDEX "units_groupId_idx" ON "units"("groupId");

-- AddForeignKey
ALTER TABLE "unit_groups" ADD CONSTRAINT "unit_groups_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "unit_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
