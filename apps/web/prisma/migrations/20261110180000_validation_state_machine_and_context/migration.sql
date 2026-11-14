-- AlterTable Mission
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "creationTxHash" TEXT;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "creationProvenance" TEXT;

-- AlterTable ValidationJob
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "leaseToken" TEXT;
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "frozenContext" TEXT;
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "chainScore" INTEGER;
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "chainTag" TEXT;
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "responseHash" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ValidationJob_leaseToken_idx" ON "ValidationJob"("leaseToken");
