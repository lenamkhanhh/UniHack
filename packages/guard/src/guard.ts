import {
  createPublicClient,
  http,
  keccak256,
  stringToBytes,
  parseAbiItem,
  PublicClient,
} from 'viem';
import {
  MissionGuardConfig,
  Proposal,
  TreasuryPayoutProposal,
  ValidationResult,
  SimulateOnChainResult,
} from './types.js';
import { computePayeeMerkleTree, PayeeMerkleTreeResult, normalizeAddress } from './merkle.js';
import { TaintRegistry } from './taint.js';
import { validateTreasuryProposal } from './validator.js';

export const DEFAULT_FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
export const DEFAULT_TREASURY_ADDRESS: `0x${string}` = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';
export const DEFAULT_AGENT_ADDRESS: `0x${string}` = '0x374b8A126FDb9e5deEc8307da385076155Af3D72';

export const proposeWithProofAbi = parseAbiItem(
  'function proposeWithProof(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string reason, bytes32[] proof) external returns (uint256)'
);

export interface MissionGuard {
  readonly config: MissionGuardConfig;
  readonly merkleTree: PayeeMerkleTreeResult;
  checkPayment(proposal: Proposal, taintRegistry?: TaintRegistry, spentTotal?: bigint): ValidationResult;
  buildProof(payeeAddress: string): `0x${string}`[] | null;
  getMerkleRoot(): `0x${string}`;
  simulateOnChain(proposal: Proposal, proof?: `0x${string}`[]): Promise<SimulateOnChainResult>;
}

export function createMissionGuard(config: MissionGuardConfig): MissionGuard {
  const merkleTree = computePayeeMerkleTree(config.payees || []);

  const guard: MissionGuard = {
    config,
    merkleTree,

    checkPayment(proposal: Proposal, taintRegistry?: TaintRegistry, spentTotal: bigint = 0n): ValidationResult {
      return validateTreasuryProposal(proposal, config, taintRegistry, spentTotal);
    },

    buildProof(payeeAddress: string): `0x${string}`[] | null {
      return merkleTree.getProof(payeeAddress);
    },

    getMerkleRoot(): `0x${string}` {
      return merkleTree.root;
    },

    async simulateOnChain(proposal: Proposal, proof?: `0x${string}`[]): Promise<SimulateOnChainResult> {
      if (proposal.kind !== 'treasury_payout') {
        return {
          success: true,
          resultOrError: 'TOOL_PURCHASE_OFFCHAIN_SETTLED',
        };
      }

      const payout = proposal as TreasuryPayoutProposal;
      const rpcUrl = config.rpcUrl || process.env.AVALANCHE_FUJI_RPC || DEFAULT_FUJI_RPC;
      const treasuryAddress = config.treasuryAddress || DEFAULT_TREASURY_ADDRESS;

      const client = createPublicClient({
        transport: http(rpcUrl),
      });

      // Prepare bytes32 missionId
      let missionIdBytes: `0x${string}`;
      if (typeof config.missionId === 'string' && config.missionId.startsWith('0x') && config.missionId.length === 66) {
        missionIdBytes = config.missionId as `0x${string}`;
      } else {
        missionIdBytes = keccak256(stringToBytes(String(config.missionId)));
      }

      // Compute proof if not provided
      const resolvedProof = proof || guard.buildProof(payout.to) || [];
      const operationId = keccak256(stringToBytes(`op-${config.missionId}-${Date.now()}-${Math.random()}`));
      const toAddr = payout.to as `0x${string}`;
      const amountAtomic = BigInt(payout.amount_atomic);
      const callerAccount = (config.agentAddress as `0x${string}`) || DEFAULT_AGENT_ADDRESS;

      try {
        const { result } = await client.simulateContract({
          address: treasuryAddress,
          abi: [proposeWithProofAbi],
          functionName: 'proposeWithProof',
          args: [operationId, toAddr, amountAtomic, missionIdBytes, payout.reason.slice(0, 200), resolvedProof],
          account: callerAccount,
        });

        return {
          success: true,
          resultOrError: 'SUCCESS',
          proposalId: result as bigint,
        };
      } catch (err: any) {
        let revertReason = 'UnknownRevert';
        const msg = String(err?.message || err);

        const knownErrors = [
          'PayeeNotInMissionSet',
          'PayeeProofRequired',
          'NotAllowlisted',
          'DirectEtherNotAccepted',
          'ExecutionFailed',
          'MissionClosedOrExpired',
          'MissionNotFound',
          'OverCap',
          'Paused',
        ];

        for (const ke of knownErrors) {
          if (msg.includes(ke)) {
            revertReason = ke;
            break;
          }
        }

        if (revertReason === 'UnknownRevert' && err?.shortMessage) {
          revertReason = err.shortMessage;
        }

        return {
          success: false,
          resultOrError: 'REVERT',
          revertReason,
        };
      }
    },
  };

  return guard;
}
