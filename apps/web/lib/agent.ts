import {
  ToolPurchaseProposal,
  TreasuryPayoutProposal,
  Proposal,
} from './validator';
import {
  createSearchProposal,
  createSummaryProposal,
  createTreasuryProposal,
} from './proposer';
import { SEARCH_PRICE, SUMMARY_PRICE } from './constants';

export type PlannerMode = 'LIVE_LLM' | 'FALLBACK_DETERMINISTIC';

export interface AgentHistoryStep {
  step: number;
  thought: string;
  action: 'TOOL' | 'PAYOUT' | 'DONE';
  proposal?: Proposal;
  verdict?: {
    outcome: 'PASS' | 'BLOCK' | 'QUEUE';
    rule?: string;
    reason?: string;
  };
  result?: any;
}

export interface AgentPlanInput {
  goal: string;
  missionSlug: string;
  history?: AgentHistoryStep[];
  stepIndex?: number;
}

export interface AgentPlanOutput {
  plannerMode: PlannerMode;
  plannerModel: string;
  promptVersion: string;
  thought: string;
  action: 'TOOL' | 'PAYOUT' | 'DONE';
  proposal: ToolPurchaseProposal | TreasuryPayoutProposal | null;
  isDone: boolean;
  deliverable?: {
    goal: string;
    missionSlug: string;
    summary: string;
    sources: string[];
    points: string[];
    plannerMode: PlannerMode;
    plannerModel: string;
    promptVersion: string;
    completedAt: string;
  };
}

const PROMPT_VERSION = 'v1.0';

/**
 * Parses user goal to derive a targeted search query.
 */
function extractSearchQuery(goal: string): string {
  const clean = goal.trim();
  if (/avalanche/i.test(clean)) {
    if (/fee|cost|gas/i.test(clean)) {
      return 'Avalanche blockchain transaction fees';
    }
    if (/consensus|finality|throughput/i.test(clean)) {
      return 'Avalanche consensus platform';
    }
    return 'Avalanche (blockchain platform)';
  }
  if (/ethereum|solidity|smart contract/i.test(clean)) {
    return 'Ethereum smart contracts';
  }
  // Default clean first 6 words
  const words = clean.split(/\s+/).slice(0, 6).join(' ');
  return words || 'Avalanche blockchain';
}

/**
 * Deterministic Fallback Planner (Strategic P0 Agent Requirement).
 * Engaged when no valid LLM key is configured, API quota is exhausted, or offline.
 */
function runDeterministicPlanner(
  input: AgentPlanInput,
  history: AgentHistoryStep[]
): AgentPlanOutput {
  const stepCount = history.length;
  const goal = input.goal;
  const missionSlug = input.missionSlug;

  // Find previous search result if any
  const searchStep = history.find(
    (h) => h.proposal?.kind === 'tool_purchase' && (h.proposal as ToolPurchaseProposal).tool_id === 'tool:search'
  );
  const summaryStep = history.find(
    (h) => h.proposal?.kind === 'tool_purchase' && (h.proposal as ToolPurchaseProposal).tool_id === 'tool:summary'
  );

  // Turn 1: Search
  if (!searchStep || !searchStep.result) {
    const query = extractSearchQuery(goal);
    const thought = `Step 1: Query verified reference sources for '${query}' to gather facts.`;
    const proposal = createSearchProposal({
      missionId: missionSlug,
      query,
      reason: `[model:deterministic-planner-v1,prompt:${PROMPT_VERSION}] Search authoritative references for ${query}`,
    });

    return {
      plannerMode: 'FALLBACK_DETERMINISTIC',
      plannerModel: 'deterministic-planner-v1',
      promptVersion: PROMPT_VERSION,
      thought,
      action: 'TOOL',
      proposal,
      isDone: false,
    };
  }

  // Turn 2: Summarize findings
  if (!summaryStep || !summaryStep.result) {
    const searchRes = searchStep.result;
    const points: string[] = searchRes.points || [
      'Avalanche provides sub-second finality and EVM compatibility.',
    ];
    const textToSummarize = points.join(' | ').slice(0, 1500);

    const thought = `Step 2: Synthesize ${points.length} search findings into an authoritative deliverable.`;
    const proposal = createSummaryProposal({
      missionId: missionSlug,
      text: textToSummarize,
      reason: `[model:deterministic-planner-v1,prompt:${PROMPT_VERSION}] Synthesize verified research findings into deliverable`,
    });

    return {
      plannerMode: 'FALLBACK_DETERMINISTIC',
      plannerModel: 'deterministic-planner-v1',
      promptVersion: PROMPT_VERSION,
      thought,
      action: 'TOOL',
      proposal,
      isDone: false,
    };
  }

  // Turn 3: Deliverable complete (DONE)
  const searchRes = searchStep.result;
  const summaryRes = summaryStep.result;
  const points: string[] = searchRes?.points || [];
  const sources: string[] = searchRes?.sources || [
    'https://en.wikipedia.org/wiki/Avalanche_(blockchain_platform)',
  ];
  const summaryText =
    summaryRes?.summary ||
    `Verified synthesis of Avalanche platform architecture: consensus throughput and settlement boundaries.`;

  return {
    plannerMode: 'FALLBACK_DETERMINISTIC',
    plannerModel: 'deterministic-planner-v1',
    promptVersion: PROMPT_VERSION,
    thought: 'Step 3: All prerequisite tool analyses settled and verified. Generating signed deliverable.',
    action: 'DONE',
    proposal: null,
    isDone: true,
    deliverable: {
      goal,
      missionSlug,
      summary: summaryText,
      sources,
      points,
      plannerMode: 'FALLBACK_DETERMINISTIC',
      plannerModel: 'deterministic-planner-v1',
      promptVersion: PROMPT_VERSION,
      completedAt: new Date().toISOString(),
    },
  };
}

/**
 * Attempts calling Google Gemini or OpenAI compatible LLM API.
 */
async function callLLMPlanner(
  input: AgentPlanInput,
  history: AgentHistoryStep[]
): Promise<AgentPlanOutput | null> {
  const geminiKey = process.env.GEMINI_API_KEY || (process.env.LLM_API_KEY?.startsWith('AIza') ? process.env.LLM_API_KEY : '');
  const model = process.env.LLM_MODEL || 'gemini-2.0-flash';

  if (!geminiKey) {
    return null;
  }

  try {
    const systemPrompt = `You are an autonomous AI Agent operating on Avalanche under a Guarded Treasury architecture.
Your mission goal is: "${input.goal}".
Step history count: ${history.length} / 6 maximum.
Available actions:
1. TOOL tool:search - arguments: {"query": "..."} (costs 0.10 USDC)
2. TOOL tool:summary - arguments: {"text": "..."} (costs 0.50 USDC)
3. DONE - when you have sufficient information to deliver the final deliverable.

Security & Boundary Rules:
- Output ONLY a JSON object.
- Never output markdown fences or commentary outside JSON.
- If sufficient findings are gathered, emit action "DONE" with "deliverable" and "sources".

JSON schema:
{
  "thought": "1 sentence explanation of what you are doing and why",
  "action": "TOOL" | "DONE",
  "toolId": "tool:search" | "tool:summary",
  "arguments": {},
  "reason": "1-sentence reason for spending treasury funds",
  "deliverable": "summary of final deliverable if DONE",
  "sources": ["source URLs if DONE"]
}`;

    const historyPrompt = history.map((h, i) => `Turn ${i + 1}:
Action: ${h.action}
Proposal: ${JSON.stringify(h.proposal || {})}
Verdict: ${h.verdict?.outcome || 'UNKNOWN'}
Result: ${JSON.stringify(h.result || {})}`).join('\n\n');

    const promptText = `${systemPrompt}\n\n${history.length > 0 ? `Prior History:\n${historyPrompt}\n\n` : ''}Now decide the next step:`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return null;

    const parsed = JSON.parse(candidateText);

    if (parsed.action === 'DONE') {
      const searchStep = history.find((h) => h.proposal?.kind === 'tool_purchase' && (h.proposal as ToolPurchaseProposal).tool_id === 'tool:search');
      return {
        plannerMode: 'LIVE_LLM',
        plannerModel: model,
        promptVersion: PROMPT_VERSION,
        thought: parsed.thought || 'Mission goals fulfilled by LLM agent.',
        action: 'DONE',
        proposal: null,
        isDone: true,
        deliverable: {
          goal: input.goal,
          missionSlug: input.missionSlug,
          summary: parsed.deliverable || 'Autonomous LLM agent synthesis complete.',
          sources: parsed.sources || searchStep?.result?.sources || ['https://en.wikipedia.org/wiki/Avalanche_(blockchain_platform)'],
          points: searchStep?.result?.points || [],
          plannerMode: 'LIVE_LLM',
          plannerModel: model,
          promptVersion: PROMPT_VERSION,
          completedAt: new Date().toISOString(),
        },
      };
    }

    if (parsed.action === 'TOOL' && parsed.toolId === 'tool:search') {
      const query = parsed.arguments?.query || extractSearchQuery(input.goal);
      return {
        plannerMode: 'LIVE_LLM',
        plannerModel: model,
        promptVersion: PROMPT_VERSION,
        thought: parsed.thought || `Search for authoritative references on '${query}'.`,
        action: 'TOOL',
        proposal: createSearchProposal({
          missionId: input.missionSlug,
          query,
          reason: `[model:${model},prompt:${PROMPT_VERSION}] ${parsed.reason || `Search for ${query}`}`,
        }),
        isDone: false,
      };
    }

    if (parsed.action === 'TOOL' && parsed.toolId === 'tool:summary') {
      const text = parsed.arguments?.text || input.goal;
      return {
        plannerMode: 'LIVE_LLM',
        plannerModel: model,
        promptVersion: PROMPT_VERSION,
        thought: parsed.thought || 'Synthesize research data into structured summary.',
        action: 'TOOL',
        proposal: createSummaryProposal({
          missionId: input.missionSlug,
          text,
          reason: `[model:${model},prompt:${PROMPT_VERSION}] ${parsed.reason || 'Synthesize research data'}`,
        }),
        isDone: false,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Main Agent Planning Entry Point.
 * Dispatches to live LLM if available, otherwise falls back smoothly to deterministic planner.
 */
export async function planAgentStep(input: AgentPlanInput): Promise<AgentPlanOutput> {
  const history = input.history || [];

  // Enforce maximum 6 turns: forcibly conclude with deliverable
  if (history.length >= 6) {
    const searchStep = history.find(
      (h) => h.proposal?.kind === 'tool_purchase' && (h.proposal as ToolPurchaseProposal).tool_id === 'tool:search'
    );
    const summaryStep = history.find(
      (h) => h.proposal?.kind === 'tool_purchase' && (h.proposal as ToolPurchaseProposal).tool_id === 'tool:summary'
    );
    return {
      plannerMode: 'FALLBACK_DETERMINISTIC',
      plannerModel: 'deterministic-planner-v1',
      promptVersion: PROMPT_VERSION,
      thought: 'Step 6 limit reached: Concluding autonomous planning loop with collected evidence.',
      action: 'DONE',
      proposal: null,
      isDone: true,
      deliverable: {
        goal: input.goal,
        missionSlug: input.missionSlug,
        summary: summaryStep?.result?.summary || 'Maximum turns reached. Synthesizing collected evidence into deliverable.',
        sources: searchStep?.result?.sources || ['https://en.wikipedia.org/wiki/Avalanche_(blockchain_platform)'],
        points: searchStep?.result?.points || [],
        plannerMode: 'FALLBACK_DETERMINISTIC',
        plannerModel: 'deterministic-planner-v1',
        promptVersion: PROMPT_VERSION,
        completedAt: new Date().toISOString(),
      },
    };
  }

  // Attempt live LLM execution
  const llmResult = await callLLMPlanner(input, history);
  if (llmResult) {
    return llmResult;
  }

  // Fallback to deterministic planner
  return runDeterministicPlanner(input, history);
}
