import { describe, it, expect, vi } from 'vitest';
import { planAgentStep, AgentHistoryStep } from '../lib/agent';
import { validateProposalSchema, ToolPurchaseProposal } from '../lib/validator';
import { toolCatalog } from '../lib/tools';

describe('AGENT-01: Autonomous AI Agent Planning Loop', () => {
  it('Turn 1: autonomously proposes tool:search with goal-directed query and labeled planner metadata', async () => {
    const plan = await planAgentStep({
      goal: 'Tóm tắt 3 nguồn về phí giao dịch và sub-second finality trên Avalanche C-Chain',
      missionSlug: 'test-agent-mission-01',
      history: [],
    });

    expect(plan.isDone).toBe(false);
    expect(plan.action).toBe('TOOL');
    expect(plan.plannerMode).toMatch(/LIVE_LLM|FALLBACK_DETERMINISTIC/);
    expect(plan.promptVersion).toBe('v1.0');
    expect(plan.thought).toContain('Step 1');
    expect(plan.proposal).not.toBeNull();
    expect(plan.proposal?.kind).toBe('tool_purchase');

    const tp = plan.proposal as ToolPurchaseProposal;
    expect(tp.tool_id).toBe('tool:search');
    expect(tp.arguments.query).toMatch(/avalanche/i);
    expect(tp.reason).toContain(plan.promptVersion);

    // Schema validation via validator.ts
    const schemaCheck = validateProposalSchema(tp);
    expect(schemaCheck.valid).toBe(true);
  });

  it('Turn 2: feeds search results back to planner and autonomously proposes tool:summary', async () => {
    // Execute real search tool to get real sources & points
    const searchResult = await toolCatalog['tool:search'].execute({
      query: 'Avalanche blockchain',
    });

    expect(searchResult.points.length).toBeGreaterThan(0);
    expect(searchResult.sources.length).toBeGreaterThan(0);

    const history: AgentHistoryStep[] = [
      {
        step: 1,
        thought: 'Step 1: Query verified reference sources for Avalanche facts.',
        action: 'TOOL',
        proposal: {
          kind: 'tool_purchase',
          mission_id: 'test-agent-mission-01',
          tool_id: 'tool:search',
          amount_atomic: '100000',
          reason: 'Search sources',
          arguments: { query: 'Avalanche blockchain' },
        },
        verdict: { outcome: 'PASS', rule: 'RULE_TOOL_WITHIN_CAP' },
        result: searchResult,
      },
    ];

    const plan = await planAgentStep({
      goal: 'Tóm tắt 3 nguồn về phí giao dịch và sub-second finality trên Avalanche C-Chain',
      missionSlug: 'test-agent-mission-01',
      history,
    });

    expect(plan.isDone).toBe(false);
    expect(plan.action).toBe('TOOL');
    expect(plan.proposal).not.toBeNull();

    const tp = plan.proposal as ToolPurchaseProposal;
    expect(tp.tool_id).toBe('tool:summary');
    expect(tp.arguments.text.length).toBeGreaterThan(0);

    const schemaCheck = validateProposalSchema(tp);
    expect(schemaCheck.valid).toBe(true);
  });

  it('Turn 3: reaches DONE, outputs deliverable with real cited sources and verifiable hash', async () => {
    const searchResult = await toolCatalog['tool:search'].execute({
      query: 'Avalanche blockchain',
    });
    const summaryResult = await toolCatalog['tool:summary'].execute({
      text: searchResult.points.join(' | '),
    });

    const history: AgentHistoryStep[] = [
      {
        step: 1,
        thought: 'Step 1: Search authoritative sources.',
        action: 'TOOL',
        proposal: {
          kind: 'tool_purchase',
          mission_id: 'test-agent-mission-01',
          tool_id: 'tool:search',
          amount_atomic: '100000',
          reason: 'Search sources',
          arguments: { query: 'Avalanche blockchain' },
        },
        verdict: { outcome: 'PASS' },
        result: searchResult,
      },
      {
        step: 2,
        thought: 'Step 2: Synthesize findings.',
        action: 'TOOL',
        proposal: {
          kind: 'tool_purchase',
          mission_id: 'test-agent-mission-01',
          tool_id: 'tool:summary',
          amount_atomic: '500000',
          reason: 'Summarize findings',
          arguments: { text: searchResult.points.join(' | ') },
        },
        verdict: { outcome: 'PASS' },
        result: summaryResult,
      },
    ];

    const plan = await planAgentStep({
      goal: 'Tóm tắt 3 nguồn về phí giao dịch và sub-second finality trên Avalanche C-Chain',
      missionSlug: 'test-agent-mission-01',
      history,
    });

    expect(plan.isDone).toBe(true);
    expect(plan.action).toBe('DONE');
    expect(plan.proposal).toBeNull();
    expect(plan.deliverable).toBeDefined();
    expect(plan.deliverable?.sources.length).toBeGreaterThan(0);
    expect(plan.deliverable?.summary.length).toBeGreaterThan(0);
    expect(plan.deliverable?.plannerMode).toMatch(/LIVE_LLM|FALLBACK_DETERMINISTIC/);
  });

  it('Safety guard: enforces maximum 6 turns to prevent infinite execution loops', async () => {
    const longHistory: AgentHistoryStep[] = Array.from({ length: 6 }, (_, i) => ({
      step: i + 1,
      thought: `Step ${i + 1}`,
      action: 'TOOL' as const,
      verdict: { outcome: 'PASS' as const },
      result: { points: ['finding'] },
    }));

    const plan = await planAgentStep({
      goal: 'Infinite task probe',
      missionSlug: 'test-agent-mission-01',
      history: longHistory,
    });

    expect(plan.promptVersion).toBe('v1.0');
    expect(plan.deliverable).toBeDefined();
  });

  it('S2-0: planner uses gemini-3.8-flash default and sends key via x-goog-api-key header without URL query param', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.LLM_MODEL;
    const originalFetch = global.fetch;

    let interceptedUrl = '';
    let interceptedHeaders: Record<string, string> = {};

    process.env.GEMINI_API_KEY = 'test-secret-gemini-key-12345';
    delete process.env.LLM_MODEL;

    global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      interceptedUrl = String(url);
      interceptedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      thought: 'Unit test mock thought',
                      action: 'DONE',
                      deliverable: 'Unit test deliverable',
                      sources: ['https://example.com'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as Response;
    });

    try {
      const plan = await planAgentStep({
        goal: 'Test S2-0 API key header security',
        missionSlug: 'test-agent-mission-s2-0',
        history: [],
      });

      expect(interceptedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
      expect(interceptedUrl).not.toContain('key=');
      expect(interceptedHeaders['x-goog-api-key']).toBe('test-secret-gemini-key-12345');
      expect(plan.plannerModel).toBe('gemini-3.8-flash');
      expect(plan.plannerMode).toBe('LIVE_LLM');
    } finally {
      process.env.GEMINI_API_KEY = originalApiKey;
      process.env.LLM_MODEL = originalModel;
      global.fetch = originalFetch;
    }
  });

  it('S2-0: respects LLM_MODEL override (e.g. gemini-3.5-flash-lite) and keeps URL key-free', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.LLM_MODEL;
    const originalFetch = global.fetch;

    let interceptedUrl = '';
    let interceptedHeaders: Record<string, string> = {};

    process.env.GEMINI_API_KEY = 'test-secret-gemini-key-12345';
    process.env.LLM_MODEL = 'gemini-3.5-flash-lite';

    global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      interceptedUrl = String(url);
      interceptedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      thought: 'Unit test mock thought',
                      action: 'DONE',
                      deliverable: 'Unit test deliverable',
                      sources: ['https://example.com'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as Response;
    });

    try {
      const plan = await planAgentStep({
        goal: 'Test S2-0 LLM_MODEL override',
        missionSlug: 'test-agent-mission-s2-0-override',
        history: [],
      });

      expect(interceptedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
      expect(interceptedUrl).not.toContain('key=');
      expect(interceptedHeaders['x-goog-api-key']).toBe('test-secret-gemini-key-12345');
      expect(plan.plannerModel).toBe('gemini-3.5-flash-lite');
    } finally {
      process.env.GEMINI_API_KEY = originalApiKey;
      process.env.LLM_MODEL = originalModel;
      global.fetch = originalFetch;
    }
  });
});
