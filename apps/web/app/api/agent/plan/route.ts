import { NextRequest, NextResponse } from 'next/server';
import { planAgentStep, AgentPlanInput } from '@/lib/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }

    const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : 'Research Avalanche platform architecture';
    const missionSlug = typeof body.missionSlug === 'string' && body.missionSlug.trim() ? body.missionSlug.trim() : `agent-mission-${Date.now()}`;
    const history = Array.isArray(body.history) ? body.history : [];

    const plan = await planAgentStep({
      goal,
      missionSlug,
      history,
    });

    return NextResponse.json(plan, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Agent planning failed' }, { status: 500 });
  }
}
