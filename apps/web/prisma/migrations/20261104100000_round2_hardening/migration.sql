-- Forward Migration for Round 2 & Round 3 Hardening (T01, T04, T05, T10, R07, R08, R13, R14)
-- Preserves existing database records, does not reset tables, and adds scoped mission projection & mode-aware checks.

-- 1. Mission scoped audit projection and public publication fields
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "auditHeadHash" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000';
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "auditEntryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "publicPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "publicationVersion" INTEGER NOT NULL DEFAULT 0;

-- 2. ToolOperation fencing lease fields and immutable paymentMode classification (T01, T04, T10)
ALTER TABLE "ToolOperation" ADD COLUMN IF NOT EXISTS "workerLeaseOwner" TEXT;
ALTER TABLE "ToolOperation" ADD COLUMN IF NOT EXISTS "workerLeaseGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ToolOperation" ADD COLUMN IF NOT EXISTS "paymentMode" TEXT;

-- Safely classify existing historical records based on evidence provenance (T04, V4-04)
-- Only classify as MOCK when explicit provenance demonstrates mock execution (txHash LIKE 'mock:%').
-- An absence of receipt (e.g. pending/signed live operations) must NOT be inferred as MOCK!
UPDATE "ToolOperation"
SET "paymentMode" = 'MOCK'
WHERE "paymentMode" IS NULL AND "txHash" LIKE 'mock:%';

UPDATE "ToolOperation"
SET "paymentMode" = 'LIVE_FUJI'
WHERE "paymentMode" IS NULL;

-- Drop legacy settled constraint first so legacy mock synthetic fields can be normalized without violation
ALTER TABLE "ToolOperation" DROP CONSTRAINT IF EXISTS "ToolOperation_settled_requires_receipt_and_result";

-- Normalize legacy synthetic mock fields before adding strict mode-aware constraints (M5-02).
-- Under 20261104000000_init, mock rows were required by ToolOperation_settled_requires_receipt_and_result
-- to have non-null receiptBlockNumber/receiptBlockHash/log indices.
-- Clear synthetic chain receipt fields for explicit MOCK rows to conform with honest mock invariant.
-- Real LIVE_FUJI evidence is strictly untouched!
UPDATE "ToolOperation"
SET "receiptBlockNumber" = NULL,
    "receiptBlockHash" = NULL,
    "authorizationLogIndex" = NULL,
    "transferLogIndex" = NULL,
    "reconcileBlockNumber" = NULL,
    "reconcileBlockHash" = NULL,
    "reconcileBlockTimestamp" = NULL
WHERE "paymentMode" = 'MOCK';

ALTER TABLE "ToolOperation" ALTER COLUMN "paymentMode" SET NOT NULL;
ALTER TABLE "ToolOperation" ALTER COLUMN "paymentMode" SET DEFAULT 'LIVE_FUJI';

ALTER TABLE "ToolOperation" DROP CONSTRAINT IF EXISTS "ToolOperation_paymentMode_check";
ALTER TABLE "ToolOperation" ADD CONSTRAINT "ToolOperation_paymentMode_check" CHECK ("paymentMode" IN ('MOCK', 'LIVE_FUJI'));

-- Mode-aware settled constraint with strict discrimination (T10)
ALTER TABLE "ToolOperation" ADD CONSTRAINT "ToolOperation_settled_requires_receipt_and_result" CHECK (
    "state" != 'SETTLED' OR
    ("heldResult" IS NOT NULL AND "heldResultHash" IS NOT NULL AND
     (
       ("paymentMode" = 'MOCK' AND "txHash" LIKE 'mock:%' AND "receiptBlockNumber" IS NULL AND "receiptBlockHash" IS NULL)
       OR
       ("paymentMode" = 'LIVE_FUJI' AND "txHash" IS NOT NULL AND "txHash" NOT LIKE 'mock:%' AND
        "receiptBlockNumber" IS NOT NULL AND "receiptBlockHash" IS NOT NULL AND
        "authorizationLogIndex" IS NOT NULL AND "transferLogIndex" IS NOT NULL)
     )
    )
);

-- 3. AuditEntry companion mission projection fields and backfill (T05)
ALTER TABLE "AuditEntry" ADD COLUMN IF NOT EXISTS "missionSlug" TEXT;
ALTER TABLE "AuditEntry" ADD COLUMN IF NOT EXISTS "missionSequence" INTEGER;
ALTER TABLE "AuditEntry" ADD COLUMN IF NOT EXISTS "missionPrevHash" TEXT;
ALTER TABLE "AuditEntry" ADD COLUMN IF NOT EXISTS "missionEntryHash" TEXT;
ALTER TABLE "AuditEntry" ADD COLUMN IF NOT EXISTS "missionCanonicalJson" TEXT;

-- Safe backfill missionSlug for historical records from persisted canonicalJson
UPDATE "AuditEntry"
SET "missionSlug" = substring("canonicalJson" from '"mission_id":"([^"]+)"')
WHERE "missionSlug" IS NULL AND "canonicalJson" LIKE '%"mission_id":%' AND substring("canonicalJson" from '"mission_id":"([^"]+)"') != '';

CREATE UNIQUE INDEX IF NOT EXISTS "AuditEntry_missionSlug_missionSequence_key" ON "AuditEntry"("missionSlug", "missionSequence");
