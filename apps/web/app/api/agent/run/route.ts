import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHash } from 'crypto';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { planAgentStep, AgentHistoryStep } from '@/lib/agent';
import {
  validateProposalSchema,
  validateProposal,
  verifyQuoteAgainstCatalog,
  ToolPurchaseProposal,
  ValidationContext,
} from '@/lib/validator';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
  executeUpstreamAndSettle,
} from '@/lib/payments';
import { appendAuditEntry } from '@/lib/audit';
import { validateLiveFujiConfig } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    // KEY-02: Enforce zero-leakage security in LIVE_FUJI mode
    validateLiveFujiConfig();

    // 1. Mandatory spend token authentication (Finding AG-01)
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Missing spend token' }, { status: 401 });
    }

    const systemState = await prisma.systemState.findUnique({ where: { id: 1 } });
    if (systemState?.systemPaused || systemState?.maintenance) {
      return NextResponse.json(
        { error: 'System is paused or in maintenance' },
        { status: 403 }
      );
    }

    let claims: any;
    try {
      claims = await verifyToken(token, {
        expectedStage: (systemState?.stage as 'S1' | 'S2') || 'S1',
      });
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired spend token' },
        { status: 401 }
      );
    }

    if (claims.type !== 'spend') {
      return NextResponse.json(
        { error: 'Spend token required for agent execution' },
        { status: 403 }
      );
    }

    // WIRE-01: In Stage S2 LIVE mode, agent cannot run if session wallet has not been confirmed funded on Fuji
    if (systemState?.stage === 'S2' && process.env.PAYMENT_MODE === 'LIVE_FUJI') {
      const entries = await prisma.auditEntry.findMany({
        where: { missionSlug: claims.missionSlug },
      });
      const isFunded = entries.some((e: any) => {
        try {
          const p = JSON.parse(e.canonicalJson);
          return (
            p.kind === 'SESSION_WALLET_FUNDED' &&
            p.tx_hash &&
            p.tx_hash.startsWith('0x') &&
            p.tx_hash.length >= 64
          );
        } catch {
          return false;
        }
      });
      if (!isFunded) {
        return NextResponse.json(
          { error: 'Cannot execute agent: mission session wallet is not funded on-chain' },
          { status: 403 }
        );
      }
    }

    // 2. Mission validation & active state check
    const mission = await prisma.mission.findUnique({
      where: { slug: claims.missionSlug },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    if (mission.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: `Mission is ${mission.status}, cannot execute agent` },
        { status: 403 }
      );
    }

    if (new Date() >= mission.expiresAt) {
      return NextResponse.json({ error: 'Mission has expired' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const goal =
      typeof body.goal === 'string' && body.goal.trim().length > 0
        ? body.goal.trim()
        : 'Tóm tắt 3 nguồn về Avalanche blockchain architecture và transaction fees';

    const history: AgentHistoryStep[] = [];
    const stepLogs: any[] = [];
    let isDone = false;
    let deliverable: any = null;
    let turn = 0;

    const sellerAddress =
      process.env.SELLER_ADDRESS || '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    // 3. Multi-turn autonomous planning loop (Max 6 turns)
    while (!isDone && turn < 6) {
      turn++;

      // AG-04: body.overrideProposal is strictly gated by ALLOW_AGENT_TEST_OVERRIDE=1 and non-production
      let plan: any;
      const allowTestOverride =
        process.env.ALLOW_AGENT_TEST_OVERRIDE === '1' &&
        process.env.NODE_ENV !== 'production';

      if (turn === 1 && body.overrideProposal && allowTestOverride) {
        plan = {
          action: body.overrideProposal.kind === 'treasury_payout' ? 'PAYOUT' : 'TOOL',
          thought: 'Test override proposal from client (ALLOW_AGENT_TEST_OVERRIDE active)',
          proposal: body.overrideProposal,
          plannerMode: 'CLIENT_OVERRIDE',
          plannerModel: 'client-test-override',
          promptVersion: 'v1.0',
          isDone: false,
        };
      } else {
        plan = await planAgentStep({
          goal,
          missionSlug: mission.slug,
          history,
        });
      }

      if (plan.isDone || plan.action === 'DONE') {
        isDone = true;
        deliverable = plan.deliverable;
        stepLogs.push({
          turn,
          thought: plan.thought,
          action: 'DONE',
          plannerMode: plan.plannerMode,
          plannerModel: plan.plannerModel,
          promptVersion: plan.promptVersion,
        });
        break;
      }

      if (plan.action === 'TOOL' || plan.action === 'PAYOUT') {
        const proposal = plan.proposal;

        // Fetch fresh mission balances under each turn
        const currentMission = await prisma.mission.findUnique({
          where: { slug: mission.slug },
        });

        if (!currentMission || currentMission.status !== 'ACTIVE') {
          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'MISSION_INACTIVE',
            error: 'Mission is no longer active',
          });
          break;
        }

        // Validate proposal schema
        const schemaCheck = validateProposalSchema(proposal);
        if (!schemaCheck.valid || !schemaCheck.proposal) {
          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'SCHEMA_INVALID',
            error: schemaCheck.error || 'Invalid proposal schema',
            verdict: { outcome: 'BLOCK', rule: 'INVALID_SCHEMA', reason: schemaCheck.error },
          });
          break;
        }

        // Construct live validation context from DB
        const allowlistEnv = process.env.TREASURY_ALLOWLIST;
        const treasuryAllowlist = allowlistEnv
          ? allowlistEnv.split(',').map((s) => s.trim()).filter(Boolean)
          : [currentMission.ownerAddress];

        const validationCtx: ValidationContext = {
          tokenClaims: claims,
          systemPaused: systemState?.systemPaused ?? false,
          maintenance: systemState?.maintenance ?? false,
          stage: (systemState?.stage as 'S1' | 'S2') || 'S1',
          mission: {
            slug: currentMission.slug,
            missionId: currentMission.missionId,
            status: currentMission.status,
            expiresAt: currentMission.expiresAt,
            ownerAddress: currentMission.ownerAddress,
            agentAddress: currentMission.agentAddress,
            toolCap: BigInt(currentMission.toolCap.toString()),
            spentTool: BigInt(currentMission.spentTool.toString()),
            reservedTool: BigInt(currentMission.reservedTool.toString()),
            treasuryCap: BigInt(currentMission.treasuryCap.toString()),
            configVersion: currentMission.configVersion,
          },
          treasuryAllowlist,
        };

        // Strict code-level policy validation (Finding AG-01)
        const verdict = validateProposal(schemaCheck.proposal, validationCtx);

        if (verdict.outcome === 'BLOCK') {
          // Log blocked attempt into audit ledger under row lock (Finding AG-01)
          const blockedId = randomUUID();
          await withLockOrder(
            async (tx) => {
              await appendAuditEntry(tx, {
                actor: claims.sub,
                amount: proposal.amount_atomic,
                chain_id: claims.chainId.toString(),
                kind: 'BLOCKED',
                mission_id: currentMission.slug,
                operation_id: blockedId,
                policy_hash: currentMission.policyHash,
                policy_version: currentMission.configVersion.toString(),
                reason: `[BLOCKED:${verdict.rule}] ${verdict.reason || proposal.reason}`,
                result_hash: '',
                rule: verdict.rule || 'RULE_BLOCK',
                source_key: `blocked:${currentMission.slug}:${turn}:${blockedId}`,
                to: proposal.kind === 'treasury_payout' ? proposal.to : '',
                tx_hash: '',
              });
            },
            { missionSlug: currentMission.slug, lockAuditHead: true }
          );

          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TOOL_BLOCKED',
            toolId: (proposal as any).tool_id || proposal.kind,
            amountAtomic: proposal.amount_atomic,
            reason: proposal.reason,
            verdict,
            plannerMode: plan.plannerMode,
            plannerModel: plan.plannerModel,
            promptVersion: plan.promptVersion,
          });

          // Abort execution immediately upon block
          break;
        }

        if (verdict.outcome === 'QUEUE') {
          // AG-05: Record treasury queue request in DB and audit ledger
          const operationId = randomUUID();
          if (proposal.kind === 'treasury_payout') {
            const requestHash =
              '0x' + createHash('sha256').update(JSON.stringify(proposal)).digest('hex');

            await prisma.treasuryRequest.create({
              data: {
                operationId,
                missionSlug: currentMission.slug,
                requestHash,
                state: 'QUEUED',
                chainId: claims.chainId || 43113,
                guardAddress: systemState?.guardAddress || 'none',
              },
            });

            await withLockOrder(
              async (tx) => {
                await appendAuditEntry(tx, {
                  actor: claims.sub,
                  amount: proposal.amount_atomic,
                  chain_id: claims.chainId.toString(),
                  kind: 'QUEUED',
                  mission_id: currentMission.slug,
                  operation_id: operationId,
                  policy_hash: currentMission.policyHash,
                  policy_version: currentMission.configVersion.toString(),
                  reason: `[QUEUED:${verdict.rule}] ${verdict.reason || proposal.reason}`,
                  result_hash: requestHash,
                  rule: verdict.rule || 'RULE_QUEUE',
                  source_key: `queued:${currentMission.slug}:${turn}:${operationId}`,
                  to: proposal.to,
                  tx_hash: '',
                });
              },
              { missionSlug: currentMission.slug, lockAuditHead: true }
            );
          }

          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'PROPOSAL_QUEUED',
            operationId,
            toolId: (proposal as any).tool_id || proposal.kind,
            amountAtomic: proposal.amount_atomic,
            reason: proposal.reason,
            verdict,
            plannerMode: plan.plannerMode,
            plannerModel: plan.plannerModel,
            promptVersion: plan.promptVersion,
          });
          break;
        }

        // AG-05: Separate branches for treasury_payout vs tool_purchase
        if (proposal.kind === 'treasury_payout') {
          // In S2, small payouts within per-tx cap pass validator.
          // The agent loop NEVER automatically executes payout; it creates a TreasuryRequest and terminates.
          const operationId = randomUUID();
          const requestHash =
            '0x' + createHash('sha256').update(JSON.stringify(proposal)).digest('hex');

          await prisma.treasuryRequest.create({
            data: {
              operationId,
              missionSlug: currentMission.slug,
              requestHash,
              state: 'CREATED',
              chainId: claims.chainId || 43113,
              guardAddress: systemState?.guardAddress || 'none',
            },
          });

          await withLockOrder(
            async (tx) => {
              await appendAuditEntry(tx, {
                actor: claims.sub,
                amount: proposal.amount_atomic,
                chain_id: claims.chainId.toString(),
                kind: 'PROPOSED',
                mission_id: currentMission.slug,
                operation_id: operationId,
                policy_hash: currentMission.policyHash,
                policy_version: currentMission.configVersion.toString(),
                reason: proposal.reason,
                result_hash: requestHash,
                rule: 'TREASURY_PROPOSED',
                source_key: `treasury:${currentMission.slug}:${turn}:${operationId}`,
                to: proposal.to,
                tx_hash: '',
              });
            },
            { missionSlug: currentMission.slug, lockAuditHead: true }
          );

          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TREASURY_PROPOSED',
            operationId,
            to: proposal.to,
            amountAtomic: proposal.amount_atomic,
            reason: proposal.reason,
            verdict,
            plannerMode: plan.plannerMode,
            plannerModel: plan.plannerModel,
            promptVersion: plan.promptVersion,
          });

          // Terminate loop — agent does not auto-disburse treasury funds
          break;
        }

        // verdict.outcome === 'PASS' for tool_purchase: Execute via real payment rail (Finding AG-01)
        const tp = proposal as ToolPurchaseProposal;
        const operationId = randomUUID();

        // 1. Create quote
        const quoteRes = await createQuote({
          operationId,
          toolId: tp.tool_id,
          input: verdict.canonicalArguments || tp.arguments,
          tokenClaims: claims,
          sellerAddress,
          appOrigin,
        });

        // P2-PRICE: Verify quote against catalog before proceeding to reserve
        const quotedAmount = BigInt(
          quoteRes.unpaidResponse.accepts[0]?.maxAmountRequired || tp.amount_atomic
        );
        const quotePriceCheck = verifyQuoteAgainstCatalog({
          toolId: tp.tool_id,
          quotedAmountAtomic: quotedAmount,
        });
        if (!quotePriceCheck.valid) {
          await withLockOrder(
            async (tx) => {
              await appendAuditEntry(tx, {
                actor: claims.sub,
                amount: quotedAmount.toString(),
                chain_id: claims.chainId.toString(),
                kind: 'BLOCKED',
                mission_id: currentMission.slug,
                operation_id: operationId,
                policy_hash: currentMission.policyHash,
                policy_version: currentMission.configVersion.toString(),
                reason: quotePriceCheck.reason || 'Quoted price exceeds catalog listing',
                result_hash: '',
                rule: quotePriceCheck.rule || 'PRICE_MISMATCH',
                source_key: `block:price:${currentMission.slug}:${turn}:${operationId}`,
                to: sellerAddress,
                tx_hash: '',
              });
            },
            { missionSlug: currentMission.slug, lockAuditHead: true }
          );

          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TOOL_BLOCKED',
            toolId: tp.tool_id,
            amountAtomic: quotedAmount.toString(),
            reason: quotePriceCheck.reason,
            verdict: {
              outcome: 'BLOCK',
              rule: quotePriceCheck.rule,
              reason: quotePriceCheck.reason,
            },
            plannerMode: plan.plannerMode,
            plannerModel: plan.plannerModel,
            promptVersion: plan.promptVersion,
          });
          break;
        }

        // 2. Reserve operation (locks budget in DB)
        await reserveOperation({
          operationId,
          tokenClaims: claims,
        });

        // 3. Sign EIP-3009 authorization
        await signOperationAuthorization({
          operationId,
          agentPrivateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
          tokenClaims: claims,
        });

        // 4. Execute tool upstream and settle on payment rails
        const execution = await executeUpstreamAndSettle({
          operationId,
          claims,
          toolId: tp.tool_id,
          arguments: verdict.canonicalArguments || tp.arguments,
        });

        const isSettled = execution.operation?.state === 'SETTLED';

        if (isSettled && execution.result) {
          history.push({
            step: turn,
            thought: plan.thought,
            action: 'TOOL',
            proposal: tp,
            verdict,
            result: execution.result,
          });

          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TOOL',
            toolId: tp.tool_id,
            operationId,
            amountAtomic: tp.amount_atomic,
            state: 'SETTLED',
            paymentMode: execution.mode,
            reason: tp.reason,
            verdict,
            plannerMode: plan.plannerMode,
            plannerModel: plan.plannerModel,
            promptVersion: plan.promptVersion,
            sources: execution.result?.sources || [],
            resultSummary: execution.result?.points
              ? `${execution.result.points.length} points`
              : (execution.result?.summary ? `${execution.result.summary.length} chars` : 'settled'),
          });
        } else {
          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TOOL_EXECUTION_UNSETTLED',
            operationId,
            state: execution.operation?.state || 'FAILED',
            failureReason: execution.operation?.failureReason,
            verdict,
          });
          break;
        }
      } else {
        break;
      }
    }

    // Refresh final mission budget state
    const finalMission = await prisma.mission.findUnique({
      where: { slug: mission.slug },
    });

    // Compute dynamic deliverable hash if deliverable was produced
    let deliverableHash: string | null = null;
    if (deliverable) {
      const deliverablePayload = JSON.stringify({
        goal,
        missionSlug: mission.slug,
        deliverable,
        stepsCount: history.length,
        completedAt: new Date().toISOString(),
      });
      deliverableHash =
        '0x' + createHash('sha256').update(deliverablePayload).digest('hex');
    }

    return NextResponse.json({
      success: isDone,
      missionSlug: mission.slug,
      goal,
      turnCount: turn,
      steps: stepLogs,
      deliverable,
      deliverableHash,
      initialBudget: mission.toolCap.toString(),
      remainingBudget: finalMission
        ? (
            BigInt(finalMission.toolCap.toString()) -
            BigInt(finalMission.spentTool.toString()) -
            BigInt(finalMission.reservedTool.toString())
          ).toString()
        : '0',
      spentTool: finalMission ? finalMission.spentTool.toString() : '0',
      plannerMode: stepLogs[0]?.plannerMode || 'FALLBACK_DETERMINISTIC',
      plannerModel: stepLogs[0]?.plannerModel || 'deterministic-planner-v1',
      promptVersion: 'v1.0',
    });
  } catch (err: any) {
    // AG-07: General error code, internal details logged to server only
    console.error('[AGENT_RUN_ERROR]', err);
    return NextResponse.json(
      { error: 'Internal agent execution error' },
      { status: 500 }
    );
  }
}
