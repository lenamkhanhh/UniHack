import { describe, it, expect } from 'vitest';
import { DEMO_SEED_MONEY_FLOW_ENTRIES } from '@/lib/demo-seeds';

describe('WOW-F1: Honest Money Flow Diagram & Audit Ledger Binding', () => {
  it('DEMO_SEED_MONEY_FLOW_ENTRIES is isolated in lib/demo-seeds.ts and has valid structure', () => {
    expect(DEMO_SEED_MONEY_FLOW_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of DEMO_SEED_MONEY_FLOW_ENTRIES) {
      expect(entry.id).toBeDefined();
      expect(entry.from).toBeDefined();
      expect(entry.to).toBeDefined();
      expect(entry.amount).toBeDefined();
      expect(['SETTLED', 'BLOCKED']).toContain(entry.status);
    }
  });

  it('No hardcoded ledger arrays remain in MoneyFlowDiagram.tsx outside seed import', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const componentCode = fs.readFileSync(
      path.resolve(__dirname, '../components/MoneyFlowDiagram.tsx'),
      'utf8'
    );

    // Verify there are no hardcoded tx-1, tx-2 arrays inside useState
    expect(componentCode.includes("id: 'tx-1'")).toBe(false);
    expect(componentCode.includes("id: 'tx-2'")).toBe(false);
    expect(componentCode.includes('DEMO_SEED_MONEY_FLOW_ENTRIES')).toBe(true);
    expect(componentCode.includes('MOCK — chưa gửi lên chain')).toBe(true);
    expect(componentCode.includes('LIVE ON AVALANCHE FUJI')).toBe(true);
  });
});
