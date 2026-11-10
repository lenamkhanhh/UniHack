-- CreateTable
CREATE TABLE IF NOT EXISTS "BountyQuotaReservation" (
    "id" UUID NOT NULL,
    "ipHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BountyQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BountyQuotaReservation_ipHash_createdAt_idx" ON "BountyQuotaReservation"("ipHash", "createdAt");
CREATE INDEX IF NOT EXISTS "BountyQuotaReservation_createdAt_idx" ON "BountyQuotaReservation"("createdAt");
CREATE INDEX IF NOT EXISTS "BountyQuotaReservation_status_leaseExpiresAt_idx" ON "BountyQuotaReservation"("status", "leaseExpiresAt");
