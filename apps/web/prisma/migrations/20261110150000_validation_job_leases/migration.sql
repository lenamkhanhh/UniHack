-- AlterTable
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "workerLeaseUntil" TIMESTAMP(3);
ALTER TABLE "ValidationJob" ADD COLUMN IF NOT EXISTS "workerLeaseOwner" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ValidationJob_status_workerLeaseUntil_idx" ON "ValidationJob"("status", "workerLeaseUntil");
