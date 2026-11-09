import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BUDGET_HUB_ABI, GATEWAY_ABI } from '@/lib/icm-abi';

describe('M9 Live ICM ABI Verification (M9-F8)', () => {
  it('verifies BUDGET_HUB_ABI missions() tuple exactly matches compiled contract struct outputs', () => {
    const hubArtifactPath = path.resolve(__dirname, '../../../contracts/out/MissionBudgetHub.sol/MissionBudgetHub.json');
    expect(fs.existsSync(hubArtifactPath)).toBe(true);

    const artifact = JSON.parse(fs.readFileSync(hubArtifactPath, 'utf8'));
    const missionsAbi = artifact.abi.find((item: any) => item.type === 'function' && item.name === 'missions');

    expect(missionsAbi).toBeDefined();
    expect(missionsAbi.outputs).toHaveLength(6);

    // Exact struct field order: (agent, payeeRoot, cap, spent, exists, closed)
    expect(missionsAbi.outputs[0].name).toBe('agent');
    expect(missionsAbi.outputs[0].type).toBe('address');

    expect(missionsAbi.outputs[1].name).toBe('payeeRoot');
    expect(missionsAbi.outputs[1].type).toBe('bytes32');

    expect(missionsAbi.outputs[2].name).toBe('cap');
    expect(missionsAbi.outputs[2].type).toBe('uint256');

    expect(missionsAbi.outputs[3].name).toBe('spent');
    expect(missionsAbi.outputs[3].type).toBe('uint256');

    expect(missionsAbi.outputs[4].name).toBe('exists');
    expect(missionsAbi.outputs[4].type).toBe('bool');

    expect(missionsAbi.outputs[5].name).toBe('closed');
    expect(missionsAbi.outputs[5].type).toBe('bool');

    // Cross-check with BUDGET_HUB_ABI definition
    const missionsParsedItem = BUDGET_HUB_ABI.find((item: any) => item.name === 'missions');
    expect(missionsParsedItem).toBeDefined();
    expect((missionsParsedItem as any).outputs).toHaveLength(6);
    expect((missionsParsedItem as any).outputs[0].type).toBe('address');
    expect((missionsParsedItem as any).outputs[1].type).toBe('bytes32');
    expect((missionsParsedItem as any).outputs[2].type).toBe('uint256');
    expect((missionsParsedItem as any).outputs[3].type).toBe('uint256');
    expect((missionsParsedItem as any).outputs[4].type).toBe('bool');
    expect((missionsParsedItem as any).outputs[5].type).toBe('bool');
  });

  it('verifies GATEWAY_ABI sendSpendRequest signature matches compiled contract', () => {
    const gatewayArtifactPath = path.resolve(__dirname, '../../../contracts/out/MissionSpendGateway.sol/MissionSpendGateway.json');
    expect(fs.existsSync(gatewayArtifactPath)).toBe(true);

    const artifact = JSON.parse(fs.readFileSync(gatewayArtifactPath, 'utf8'));
    const sendAbi = artifact.abi.find((item: any) => item.type === 'function' && item.name === 'sendSpendRequest');

    expect(sendAbi).toBeDefined();
    expect(sendAbi.inputs).toHaveLength(4);
    expect(sendAbi.inputs[0].name).toBe('missionId');
    expect(sendAbi.inputs[0].type).toBe('bytes32');
    expect(sendAbi.inputs[1].name).toBe('payee');
    expect(sendAbi.inputs[1].type).toBe('address');
    expect(sendAbi.inputs[2].name).toBe('amount');
    expect(sendAbi.inputs[2].type).toBe('uint256');
    expect(sendAbi.inputs[3].name).toBe('proof');
    expect(sendAbi.inputs[3].type).toBe('bytes32[]');

    expect(sendAbi.outputs).toHaveLength(2);
    expect(sendAbi.outputs[0].name).toBe('messageId');
    expect(sendAbi.outputs[0].type).toBe('bytes32');
    expect(sendAbi.outputs[1].name).toBe('teleporterMessageID');
    expect(sendAbi.outputs[1].type).toBe('uint256');
  });
});
