-- CreateTable SystemState
CREATE TABLE "SystemState" (
    "id" INTEGER NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "guardAddress" TEXT,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "systemPaused" BOOLEAN NOT NULL DEFAULT false,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SystemState_single_row_check" CHECK ("id" = 1),
    CONSTRAINT "SystemState_stage_check" CHECK ("stage" IN ('S1', 'S2'))
);

-- CreateTable Mission
CREATE TABLE "Mission" (
    "slug" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "agentAddress" TEXT NOT NULL,
    "treasuryCap" DECIMAL(78,0) NOT NULL,
    "toolCap" DECIMAL(78,0) NOT NULL,
    "spentTool" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "reservedTool" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "deliverableHash" TEXT,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "policyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("slug"),
    CONSTRAINT "Mission_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED')),
    CONSTRAINT "Mission_caps_non_negative" CHECK (
        "treasuryCap" >= 0 AND "treasuryCap" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
        "toolCap" >= 0 AND "toolCap" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
        "spentTool" >= 0 AND "spentTool" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
        "reservedTool" >= 0 AND "reservedTool" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    ),
    CONSTRAINT "Mission_tool_exposure_limit" CHECK (
        "spentTool" + "reservedTool" <= "toolCap"
    )
);

-- CreateTable AuthChallenge
CREATE TABLE "AuthChallenge" (
    "nonce" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "expectedSigner" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable ToolSession
CREATE TABLE "ToolSession" (
    "id" UUID NOT NULL,
    "missionSlug" TEXT NOT NULL,
    "payerAddress" TEXT NOT NULL,
    "rate" DECIMAL(78,0) NOT NULL,
    "cap" DECIMAL(78,0) NOT NULL,
    "spent" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "ToolSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ToolSession_status_check" CHECK ("status" IN ('ACTIVE', 'STOPPED', 'CAPPED')),
    CONSTRAINT "ToolSession_amounts_non_negative" CHECK (
        "rate" >= 0 AND "rate" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
        "cap" >= 0 AND "cap" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
        "spent" >= 0 AND "spent" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
        "reserved" >= 0 AND "reserved" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    ),
    CONSTRAINT "ToolSession_exposure_limit" CHECK (
        "spent" + "reserved" <= "cap"
    )
);

-- CreateTable ToolOperation
CREATE TABLE "ToolOperation" (
    "operationId" UUID NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "missionSlug" TEXT NOT NULL,
    "payerAddress" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "paymentTermsHash" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "asset" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "authDeploymentVersion" INTEGER NOT NULL,
    "quoteExpiresAt" TIMESTAMP(3) NOT NULL,
    "reservationExpiresAt" TIMESTAMP(3),
    "reservedAmount" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "authFrom" TEXT,
    "authTo" TEXT,
    "authValue" DECIMAL(78,0),
    "authNonce" TEXT,
    "validAfter" BIGINT,
    "validBefore" BIGINT,
    "authSignature" TEXT,
    "heldResult" TEXT,
    "heldResultHash" TEXT,
    "workerLeaseUntil" TIMESTAMP(3),
    "submissionStartedAt" TIMESTAMP(3),
    "facilitator" TEXT,
    "facilitatorTxHash" TEXT,
    "txHash" TEXT,
    "receiptBlockNumber" BIGINT,
    "receiptBlockHash" TEXT,
    "authorizationLogIndex" INTEGER,
    "transferLogIndex" INTEGER,
    "lastReconciledAt" TIMESTAMP(3),
    "reconcileBlockNumber" BIGINT,
    "reconcileBlockHash" TEXT,
    "reconcileBlockTimestamp" BIGINT,
    "failureReason" TEXT,
    "sessionId" UUID,
    "minuteIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolOperation_pkey" PRIMARY KEY ("operationId"),
    CONSTRAINT "ToolOperation_state_check" CHECK ("state" IN (
        'CREATED', 'RESERVED', 'SIGNED', 'SUBMITTING', 'SETTLING', 'UNKNOWN', 'SETTLED', 'FAILED'
    )),
    CONSTRAINT "ToolOperation_reservedAmount_non_negative" CHECK (
        "reservedAmount" >= 0 AND "reservedAmount" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    ),
    CONSTRAINT "ToolOperation_authValue_uint256_range" CHECK (
        "authValue" IS NULL OR ("authValue" >= 0 AND "authValue" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)
    ),
    CONSTRAINT "ToolOperation_session_minute_check" CHECK (
        ("sessionId" IS NULL AND "minuteIndex" IS NULL) OR
        ("sessionId" IS NOT NULL AND "minuteIndex" IS NOT NULL AND "minuteIndex" >= 0)
    ),
    CONSTRAINT "ToolOperation_signed_requires_auth" CHECK (
        "state" NOT IN ('SIGNED', 'SUBMITTING', 'SETTLING', 'UNKNOWN', 'SETTLED') OR
        ("authFrom" IS NOT NULL AND "authTo" IS NOT NULL AND "authValue" IS NOT NULL AND
         "authNonce" IS NOT NULL AND "validAfter" IS NOT NULL AND "validBefore" IS NOT NULL AND
         "authSignature" IS NOT NULL)
    ),
    CONSTRAINT "ToolOperation_settled_requires_receipt_and_result" CHECK (
        "state" != 'SETTLED' OR
        ("heldResult" IS NOT NULL AND "heldResultHash" IS NOT NULL AND "txHash" IS NOT NULL AND
         "receiptBlockNumber" IS NOT NULL AND "receiptBlockHash" IS NOT NULL AND
         "authorizationLogIndex" IS NOT NULL AND "transferLogIndex" IS NOT NULL)
    ),
    CONSTRAINT "ToolOperation_failed_requires_reason" CHECK (
        "state" != 'FAILED' OR "failureReason" IS NOT NULL
    )
);

-- CreateTable TreasuryRequest
CREATE TABLE "TreasuryRequest" (
    "operationId" UUID NOT NULL,
    "missionSlug" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "agentNonce" BIGINT,
    "rawTxHash" TEXT,
    "proposalId" TEXT,
    "chainId" INTEGER NOT NULL,
    "guardAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryRequest_pkey" PRIMARY KEY ("operationId")
);

-- CreateTable AuditHead
CREATE TABLE "AuditHead" (
    "id" INTEGER NOT NULL,
    "lastHash" TEXT NOT NULL,

    CONSTRAINT "AuditHead_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditHead_single_row_check" CHECK ("id" = 1)
);

-- CreateTable AuditEntry
CREATE TABLE "AuditEntry" (
    "id" BIGSERIAL NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "canonicalJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable MissionFeedback
CREATE TABLE "MissionFeedback" (
    "missionSlug" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "registry" TEXT NOT NULL,
    "clientAddress" TEXT NOT NULL,
    "txHash" TEXT,
    "feedbackIndex" TEXT,
    "feedbackURI" TEXT,
    "feedbackHash" TEXT,
    "preparedValue" INTEGER,
    "preparedResultHash" TEXT,
    "state" TEXT NOT NULL,

    CONSTRAINT "MissionFeedback_pkey" PRIMARY KEY ("missionSlug")
);

-- Indexes & Uniques
CREATE UNIQUE INDEX "Mission_missionId_key" ON "Mission"("missionId");
CREATE UNIQUE INDEX "AuditEntry_sourceKey_key" ON "AuditEntry"("sourceKey");
CREATE UNIQUE INDEX "AuditEntry_entryHash_key" ON "AuditEntry"("entryHash");
CREATE UNIQUE INDEX "ToolOperation_sessionId_minuteIndex_key" ON "ToolOperation"("sessionId", "minuteIndex");
CREATE UNIQUE INDEX "ToolOperation_chainId_asset_authFrom_authNonce_key" ON "ToolOperation"("chainId", "asset", "authFrom", "authNonce");
CREATE INDEX "ToolOperation_missionSlug_state_idx" ON "ToolOperation"("missionSlug", "state");

-- Foreign Keys
ALTER TABLE "ToolSession" ADD CONSTRAINT "ToolSession_missionSlug_fkey" FOREIGN KEY ("missionSlug") REFERENCES "Mission"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToolOperation" ADD CONSTRAINT "ToolOperation_missionSlug_fkey" FOREIGN KEY ("missionSlug") REFERENCES "Mission"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToolOperation" ADD CONSTRAINT "ToolOperation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ToolSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Initial Seed for Singletons (Finding F9)
INSERT INTO "AuditHead" ("id", "lastHash") VALUES (1, '0x0000000000000000000000000000000000000000000000000000000000000000') ON CONFLICT DO NOTHING;
INSERT INTO "SystemState" ("id", "deploymentId", "stage", "guardAddress", "authVersion", "systemPaused", "maintenance", "updatedAt")
VALUES (1, 'unihack-s1-deployment', 'S1', NULL, 1, false, false, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
