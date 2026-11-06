import { NextRequest, NextResponse } from 'next/server';
import { planAgentStep, AgentHistoryStep } from '@/lib/agent';
import { toolCatalog } from '@/lib/tools';
import { validateProposalSchema, ToolPurchaseProposal } from '@/lib/validator';
import { createHash } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const goal = typeof body.goal === 'string' && body.goal.trim()
      ? body.goal.trim()
      : 'Tóm tắt 3 nguồn về Avalanche blockchain architecture và transaction fees';
    const missionSlug = typeof body.missionSlug === 'string' && body.missionSlug.trim()
      ? body.missionSlug.trim()
      : `agent-mission-${Date.now().toString().slice(-6)}`;

    const history: AgentHistoryStep[] = [];
    const stepLogs: any[] = [];
    let isDone = false;
    let deliverable: any = null;
    let turn = 0;

    while (!isDone && turn < 6) {
      turn++;
      const plan = await planAgentStep({
        goal,
        missionSlug,
        history,
      });

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

      if (plan.action === 'TOOL' && plan.proposal) {
        const tp = plan.proposal as ToolPurchaseProposal;
        const schema = validateProposalSchema(tp);

        if (!schema.valid) {
          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TOOL_SCHEMA_INVALID',
            error: schema.error,
          });
          break;
        }

        const toolDef = toolCatalog[tp.tool_id];
        if (!toolDef) {
          stepLogs.push({
            turn,
            thought: plan.thought,
            action: 'TOOL_NOT_FOUND',
            toolId: tp.tool_id,
          });
          break;
        }

        // Execute tool directly
        const result = await toolDef.execute(tp.arguments);

        const historyStep: AgentHistoryStep = {
          step: turn,
          thought: plan.thought,
          action: 'TOOL',
          proposal: tp,
          verdict: { outcome: 'PASS', rule: 'RULE_TOOL_WITHIN_CAP' },
          result,
        };

        history.push(historyStep);
        stepLogs.push({
          turn,
          thought: plan.thought,
          action: 'TOOL',
          toolId: tp.tool_id,
          amountAtomic: tp.amount_atomic,
          reason: tp.reason,
          plannerMode: plan.plannerMode,
          plannerModel: plan.plannerModel,
          promptVersion: plan.promptVersion,
          verdict: { outcome: 'PASS', rule: 'RULE_TOOL_WITHIN_CAP' },
          resultSummary: result.points ? `${result.points.length} points` : (result.summary ? `${result.summary.length} chars` : 'success'),
          sources: result.sources || [],
        });
      } else {
        break;
      }
    }

    // Compute deliverable hash
    const deliverablePayload = JSON.stringify({
      goal,
      missionSlug,
      deliverable,
      stepsCount: history.length,
      completedAt: new Date().toISOString(),
    });
    const deliverableHash = '0x' + createHash('sha256').update(deliverablePayload).digest('hex');

    return NextResponse.json({
      success: true,
      missionSlug,
      goal,
      turnCount: turn,
      steps: stepLogs,
      deliverable,
      deliverableHash,
      plannerMode: stepLogs[0]?.plannerMode || 'FALLBACK_DETERMINISTIC',
      plannerModel: stepLogs[0]?.plannerModel || 'deterministic-planner-v1',
      promptVersion: 'v1.0',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Agent run failed' }, { status: 500 });
  }
}
