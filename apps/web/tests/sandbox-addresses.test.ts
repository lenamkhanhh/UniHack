import { describe, it, expect } from 'vitest';
import { SANDBOX_OWNER, SANDBOX_AGENT, getArenaValidationContext } from '../lib/arena';
import { executeBankrReplay } from '../lib/bankr-replay';
import fs from 'fs';
import path from 'path';

describe('WOW-F6: Sandbox Addresses Invariant Suite', () => {
  it('WOW-F6: Uses explicit sandbox addresses and contains zero public Anvil addresses in arena, bankr, and verify routes', () => {
    expect(SANDBOX_OWNER).toBe('0x00000000000000000000000000000000000A11CE');
    expect(SANDBOX_AGENT).toBe('0x00000000000000000000000000000000000A6E47');

    const ctx = getArenaValidationContext();
    expect(ctx.tokenClaims.owner).toBe(SANDBOX_OWNER);
    expect(ctx.tokenClaims.agent).toBe(SANDBOX_AGENT);
    expect(ctx.mission.ownerAddress).toBe(SANDBOX_OWNER);
    expect(ctx.mission.agentAddress).toBe(SANDBOX_AGENT);

    // Verify file contents on disk
    const filesToCheck = [
      path.resolve(__dirname, '../lib/arena.ts'),
      path.resolve(__dirname, '../lib/bankr-replay.ts'),
      path.resolve(__dirname, '../app/api/verify/[missionId]/route.ts'),
      path.resolve(__dirname, '../lib/demo-seeds.ts'),
    ];

    const anvilRegex = /0x976EA740|0x70997970/i;

    for (const filePath of filesToCheck) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(anvilRegex.test(content), `Found public Anvil address in ${filePath}`).toBe(false);
      }
    }
  });
});
