-- CreateTable
CREATE TABLE "GuestReadingAccess" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestReadingAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestReadingAccess_token_key" ON "GuestReadingAccess"("token");

-- CreateIndex
CREATE INDEX "GuestReadingAccess_productionId_eventId_idx" ON "GuestReadingAccess"("productionId", "eventId");

-- CreateIndex
CREATE INDEX "GuestReadingAccess_expiresAt_idx" ON "GuestReadingAccess"("expiresAt");

-- CreateIndex
CREATE INDEX "GuestReadingAccess_revokedAt_idx" ON "GuestReadingAccess"("revokedAt");

-- AddForeignKey
ALTER TABLE "GuestReadingAccess" ADD CONSTRAINT "GuestReadingAccess_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestReadingAccess" ADD CONSTRAINT "GuestReadingAccess_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
