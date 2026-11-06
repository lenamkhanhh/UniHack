import { describe, it, expect } from 'vitest';
import {
  submitErc8004Feedback,
  ERC8004_FUJI_IDENTITY_REGISTRY,
  ERC8004_FUJI_REPUTATION_REGISTRY,
} from '../lib/erc8004';
import { getSessionWalletForMission } from '../lib/session-wallets';

describe('P1-A & P1-B: Session Wallets & ERC-8004 Integration Suite', () => {
  it('P1-A: getSessionWalletForMission generates isolated deterministic session wallet per mission', () => {
    const wallet1 = getSessionWalletForMission('mission-alpha');
    const wallet2 = getSessionWalletForMission('mission-beta');
    const wallet1Repeat = getSessionWalletForMission('mission-alpha');

    // Deterministic per mission
    expect(wallet1.address).toBe(wallet1Repeat.address);
    expect(wallet1.privateKey).toBe(wallet1Repeat.privateKey);

    // Isolated between different missions
    expect(wallet1.address).not.toBe(wallet2.address);
    expect(wallet1.privateKey).not.toBe(wallet2.privateKey);

    // Valid Avalanche/EVM address and private key
    expect(wallet1.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet1.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('P1-B: ERC-8004 registry addresses are pinned correctly to official Fuji contracts', () => {
    expect(ERC8004_FUJI_IDENTITY_REGISTRY).toBe(
      '0x8004A818BFB912233c491871b3d84c89A494BD9e'
    );
    expect(ERC8004_FUJI_REPUTATION_REGISTRY).toBe(
      '0x8004B663056A597Dffe9eCcC1965A193B7388713'
    );
  });

  it('P1-B: submitErc8004Feedback requires SETTLED state and owner confirmation', async () => {
    const seller = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

    // 1. Operation not settled -> fails
    const failUnsettled = await submitErc8004Feedback({
      sellerAddress: seller,
      operationId: 'op-123',
      operationState: 'RESERVED',
      ownerConfirmed: true,
    });
    expect(failUnsettled.success).toBe(false);
    expect(failUnsettled.error).toContain('must be SETTLED');

    // 2. Owner not confirmed -> fails
    const failUnconfirmed = await submitErc8004Feedback({
      sellerAddress: seller,
      operationId: 'op-123',
      operationState: 'SETTLED',
      ownerConfirmed: false,
    });
    expect(failUnconfirmed.success).toBe(false);
    expect(failUnconfirmed.error).toContain('owner confirmation required');

    // 3. SETTLED and owner confirmed -> succeeds in MOCK mode with simulation receipt
    const successResult = await submitErc8004Feedback({
      sellerAddress: seller,
      operationId: 'op-123',
      operationState: 'SETTLED',
      ownerConfirmed: true,
      score: 87,
      tag: 'starred',
    });
    expect(successResult.success).toBe(true);
    expect(successResult.mode).toBe('MOCK');
    expect(successResult.score).toBe(87);
    expect(successResult.simulated).toBe(true);
    expect(successResult.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
