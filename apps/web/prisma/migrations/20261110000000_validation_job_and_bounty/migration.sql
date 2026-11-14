-- AlterTable
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "creationBlock" BIGINT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BountyAttempt" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vector" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payloadPreview" TEXT NOT NULL,
    "attackerAddress" TEXT NOT NULL,
    "llmTricked" BOOLEAN NOT NULL,
    "offchainRule" TEXT,
    "onchainResult" TEXT,
    "model" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'llm',
    "source" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'BLOCKED',
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BountyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ValidationJob" (
    "id" UUID NOT NULL,
    "missionSlug" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'LIVE_FUJI',
    "fromBlock" BIGINT,
    "toBlock" BIGINT,
    "snapshotBlock" BIGINT,
    "evaluationResult" TEXT,
    "score" INTEGER,
    "tag" TEXT,
    "validatorAddress" TEXT,
    "agentId" TEXT,
    "unsignedRequest" TEXT,
    "requestTxHash" TEXT,
    "responseTxHash" TEXT,
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BountyAttempt_timestamp_idx" ON "BountyAttempt"("timestamp");
CREATE INDEX IF NOT EXISTS "BountyAttempt_ipHash_timestamp_idx" ON "BountyAttempt"("ipHash", "timestamp");
CREATE INDEX IF NOT EXISTS "BountyAttempt_mode_source_idx" ON "BountyAttempt"("mode", "source");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ValidationJob_missionSlug_key" ON "ValidationJob"("missionSlug");
CREATE UNIQUE INDEX IF NOT EXISTS "ValidationJob_requestHash_key" ON "ValidationJob"("requestHash");
CREATE INDEX IF NOT EXISTS "ValidationJob_status_idx" ON "ValidationJob"("status");
CREATE INDEX IF NOT EXISTS "ValidationJob_missionSlug_idx" ON "ValidationJob"("missionSlug");

-- AddForeignKey
ALTER TABLE "ValidationJob" ADD CONSTRAINT "ValidationJob_missionSlug_fkey" FOREIGN KEY ("missionSlug") REFERENCES "Mission"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
