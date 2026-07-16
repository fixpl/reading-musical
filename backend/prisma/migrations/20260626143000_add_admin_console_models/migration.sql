-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AdminSettingValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Organization" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ActivityLog" ALTER COLUMN "productionId" DROP NOT NULL;
ALTER TABLE "ActivityLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "reason" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "beforeJson" JSONB;
ALTER TABLE "ActivityLog" ADD COLUMN "afterJson" JSONB;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "productionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "assigneeRole" "ProductionRole",
    "staffDiscipline" "StaffDiscipline",
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "AdminSettingValueType" NOT NULL DEFAULT 'JSON',
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_phase_label_key" ON "ChecklistTemplate"("phase", "label");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_phase_active_idx" ON "ChecklistTemplate"("phase", "active");

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_createdAt_idx" ON "ActivityLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_actorId_createdAt_idx" ON "ActivityLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
