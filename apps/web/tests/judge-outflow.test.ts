import { describe, it, expect } from 'vitest';
import { measuredOutflowAtomic } from '../lib/judge-service';

const USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';
const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a: string) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
const treasury = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';

describe('judge outflow is measured from Transfer logs', () => {
  it('counts only USDC transfers out of the treasury', () => {
    const logs = [
      { address: USDC, topics: [T, pad(treasury), pad('0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA')], data: '0x' + (10000).toString(16).padStart(64, '0') },
      { address: USDC, topics: [T, pad('0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c'), pad(treasury)], data: '0x' + (999).toString(16).padStart(64, '0') },
      { address: '0x0000000000000000000000000000000000000001', topics: [T, pad(treasury), pad(treasury)], data: '0x' + (5).toString(16).padStart(64, '0') },
    ];
    expect(measuredOutflowAtomic({ logs })).toBe(10000n);
  });
  it('is zero for a reverted tx with no logs', () => {
    expect(measuredOutflowAtomic({ logs: [] })).toBe(0n);
  });
});

import { classifyError } from '../lib/judge-service';

describe('judge revert reason is the one the contract gave', () => {
  it('extracts the decoded reason', () => {
    const r = classifyError({ shortMessage: 'The contract function "proposeWithProof" reverted with the following reason:\nMissionExpired' });
    expect(r.isRevert).toBe(true);
    expect(r.reason).toBe('MissionExpired');
  });
  it('never defaults an undecoded revert to PayeeNotInMissionSet', () => {
    const r = classifyError({ message: 'execution reverted' });
    expect(r.isRevert).toBe(true);
    expect(r.reason).not.toBe('PayeeNotInMissionSet');
  });
});
