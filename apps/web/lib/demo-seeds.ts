/**
 * Demo Seed Fixtures for Offline Presentation Mode (DEMO SEED ONLY)
 * Strictly labeled as non-production fixtures.
 */

export interface SeedLedgerEntry {
  id: string;
  from: string;
  to: string;
  amount: string;
  status: 'SETTLED' | 'BLOCKED';
  rule?: string;
  txHash: string;
}

export const DEMO_SEED_MONEY_FLOW_ENTRIES: SeedLedgerEntry[] = [
  {
    id: 'seed-tx-01',
    from: 'Treasury (0x4296...)',
    to: 'Session #1 (0x5E55...)',
    amount: '5.00 USDC',
    status: 'SETTLED',
    txHash: '',
  },
  {
    id: 'seed-tx-02',
    from: 'Session #1 (0x5E55...)',
    to: 'Search Tool (0x7001...)',
    amount: '0.10 USDC',
    status: 'SETTLED',
    txHash: '',
  },
  {
    id: 'seed-blk-03',
    from: 'Session #1 (0x5E55...)',
    to: 'Attacker (0xA77AC...)',
    amount: '50.00 USDC',
    status: 'BLOCKED',
    rule: 'RECIPIENT_NOT_ALLOWLISTED',
    txHash: '',
  },
];

export const DEMO_SEED_VERIFY_PAYLOAD = {
  missionId: 'demo-seed',
  isSeededDemo: true,
  anchorStatus: {
    status: 'MOCK',
    label: 'DEMO SEED — Không neo on-chain',
    note: 'Chế độ mô phỏng offline cho máy chiếu, txHash rỗng',
  },
  entries: [
    {
      sourceKey: 'seed:fund:0',
      prevHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      entryHash: '', // computed deterministically in verify route
      canonicalJson: '{"action":"SESSION_WALLET_FUNDED","amount":"5000000","missionId":"demo-seed","note":"DEMO SEED ONLY"}',
      txHash: '',
    },
    {
      sourceKey: 'seed:tool:1',
      prevHash: '',
      entryHash: '',
      canonicalJson: '{"action":"TOOL_PAID","amount":"100000","missionId":"demo-seed","reason":"Search Avalanche fee metrics"}',
      txHash: '',
    },
    {
      sourceKey: 'seed:blocked:2',
      prevHash: '',
      entryHash: '',
      canonicalJson: '{"action":"ATTACK_BLOCKED","amount":"50000000","missionId":"demo-seed","rule":"RECIPIENT_NOT_ALLOWLISTED"}',
      txHash: '',
    },
  ],
};
