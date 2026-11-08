import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createMissionGuard,
  computePayeeMerkleTree,
  TaintRegistry,
  Proposal,
  DEFAULT_FUJI_RPC,
  DEFAULT_TREASURY_ADDRESS,
  normalizeAddress,
} from '@missionpay/guard';
import { createPublicClient, http, keccak256, stringToBytes, parseAbiItem } from 'viem';

export const missionsAbi = parseAbiItem(
  'function missions(bytes32 missionId) external view returns (bytes32 id, address agent, uint256 cap, uint256 expiresAt, bool exists, bool closed)'
);

export const missionPayeeRootAbi = parseAbiItem(
  'function missionPayeeRoot(bytes32 missionId) external view returns (bytes32)'
);

export function createMissionPayMcpServer(): McpServer {
  const server = new McpServer({
    name: 'missionpay-mcp',
    version: '0.1.0',
  });

  // Tool 1: missionpay_check_payment
  server.tool(
    'missionpay_check_payment',
    'Validate payment proposal against deterministic dual-layer Merkle guard and provenance taint registry without executing on-chain',
    {
      mission_id: z.string().describe('Mission ID or slug (e.g. "mission-research-01")'),
      to: z.string().describe('Recipient EVM address (0x...)'),
      amount_atomic: z.string().describe('Payment amount in atomic units (6 decimals for USDC, e.g. "1000000" = 1.00 USDC)'),
      reason: z.string().describe('Payment purpose, contractor description or invoice memo (max 200 UTF-8 bytes)'),
      payees: z.array(z.string()).optional().describe('Owner-signed authorized payee addresses for this mission'),
      untrusted_texts: z.array(z.string()).optional().describe('Raw texts from web pages or untrusted tool outputs to check for injected recipients/amounts'),
      per_tx_cap_atomic: z.string().optional().describe('Optional per-transaction cap in atomic units (default: 2000000 = 2 USDC)'),
      mission_cap_atomic: z.string().optional().describe('Optional total mission budget cap in atomic units (default: 10000000 = 10 USDC)'),
    },
    async ({
      mission_id,
      to,
      amount_atomic,
      reason,
      payees = [],
      untrusted_texts = [],
      per_tx_cap_atomic = '2000000',
      mission_cap_atomic = '10000000',
    }) => {
      const taint = new TaintRegistry();
      for (const text of untrusted_texts) {
        taint.record(text, 'WEB');
      }

      const guard = createMissionGuard({
        missionId: mission_id,
        payees,
        caps: {
          perTxCapAtomic: BigInt(per_tx_cap_atomic),
          missionCapAtomic: BigInt(mission_cap_atomic),
        },
      });

      const proposal: Proposal = {
        kind: 'treasury_payout',
        mission_id,
        to,
        amount_atomic,
        reason,
      };

      const result = guard.checkPayment(proposal, taint);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                outcome: result.outcome,
                rule: result.rule,
                reason: result.reason,
                toProvenance: result.toProvenance,
                amountProvenance: result.amountProvenance,
                payeeAuthorizedInRoot: result.outcome === 'PASS',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 2: missionpay_propose_payout
  server.tool(
    'missionpay_propose_payout',
    'Build a cryptographically verifiable payout proposal and generate the required OpenZeppelin Merkle proof for GuardedTreasury.proposeWithProof. This tool generates proposals and proofs; it NEVER holds, accesses, or requires private keys.',
    {
      mission_id: z.string().describe('Mission ID or slug'),
      to: z.string().describe('Recipient EVM address (0x...)'),
      amount_atomic: z.string().describe('Payment amount in atomic units (6 decimals for USDC)'),
      reason: z.string().describe('Payment purpose or invoice memo (max 200 UTF-8 bytes)'),
      payees: z.array(z.string()).optional().describe('Owner-signed authorized payee addresses for this mission'),
      untrusted_texts: z.array(z.string()).optional().describe('Raw texts from web pages or untrusted tool outputs to check for injected recipients/amounts'),
      operation_id: z.string().optional().describe('Unique client operation ID (bytes32 hex or string; auto-generated if omitted)'),
    },
    async ({
      mission_id,
      to,
      amount_atomic,
      reason,
      payees = [],
      untrusted_texts = [],
      operation_id,
    }) => {
      const taint = new TaintRegistry();
      for (const text of untrusted_texts) {
        taint.record(text, 'WEB');
      }

      const guard = createMissionGuard({
        missionId: mission_id,
        payees,
      });

      const proposal: Proposal = {
        kind: 'treasury_payout',
        mission_id,
        to,
        amount_atomic,
        reason,
      };

      const check = guard.checkPayment(proposal, taint);
      if (check.outcome !== 'PASS') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'REJECTED_BY_GUARD',
                  outcome: check.outcome,
                  rule: check.rule,
                  reason: check.reason,
                  toProvenance: check.toProvenance,
                  proof: [],
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const proof = guard.buildProof(to) || [];
      const opId =
        operation_id && operation_id.startsWith('0x') && operation_id.length === 66
          ? operation_id
          : keccak256(stringToBytes(operation_id || `mcp-payout-${mission_id}-${Date.now()}-${Math.random()}`));

      let missionIdBytes32: `0x${string}`;
      if (mission_id.startsWith('0x') && mission_id.length === 66) {
        missionIdBytes32 = mission_id as `0x${string}`;
      } else {
        missionIdBytes32 = keccak256(stringToBytes(mission_id));
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'READY_TO_SUBMIT',
                outcome: 'PASS',
                proposal: {
                  operationId: opId,
                  to: normalizeAddress(to),
                  amountAtomic: amount_atomic,
                  missionId: missionIdBytes32,
                  reason: reason.slice(0, 200),
                },
                merkleRoot: guard.getMerkleRoot(),
                proof,
                contractTarget: DEFAULT_TREASURY_ADDRESS,
                calldataFunction: 'proposeWithProof(bytes32,address,uint256,bytes32,string,bytes32[])',
                securityNotice: 'Proposal and cryptographic Merkle proof generated successfully. Submit via your preferred agent signer or smart wallet.',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 3: missionpay_verify_mission
  server.tool(
    'missionpay_verify_mission',
    'Inspects on-chain mission state and Merkle root on Avalanche Fuji C-Chain, verifying whether a mission is active and computing its cryptographic root.',
    {
      mission_id: z.string().describe('Mission ID or slug'),
      payees: z.array(z.string()).optional().describe('List of payee addresses to compute and verify against the on-chain Merkle root'),
      rpc_url: z.string().optional().describe('Avalanche RPC URL (defaults to Avalanche Fuji Testnet)'),
      treasury_address: z.string().optional().describe('GuardedTreasury contract address'),
    },
    async ({
      mission_id,
      payees = [],
      rpc_url = DEFAULT_FUJI_RPC,
      treasury_address = DEFAULT_TREASURY_ADDRESS,
    }) => {
      let missionIdBytes: `0x${string}`;
      if (mission_id.startsWith('0x') && mission_id.length === 66) {
        missionIdBytes = mission_id as `0x${string}`;
      } else {
        missionIdBytes = keccak256(stringToBytes(mission_id));
      }

      const tree = computePayeeMerkleTree(payees);
      const client = createPublicClient({
        transport: http(rpc_url),
      });

      let onchainRoot: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000';
      let missionExists = false;
      let missionClosed = false;
      let onchainCap = 0n;

      try {
        const root = (await client.readContract({
          address: treasury_address as `0x${string}`,
          abi: [missionPayeeRootAbi],
          functionName: 'missionPayeeRoot',
          args: [missionIdBytes],
        })) as `0x${string}`;
        onchainRoot = root;

        const missionData = (await client.readContract({
          address: treasury_address as `0x${string}`,
          abi: [missionsAbi],
          functionName: 'missions',
          args: [missionIdBytes],
        })) as [string, string, bigint, bigint, boolean, boolean];

        missionExists = missionData[4];
        missionClosed = missionData[5];
        onchainCap = missionData[2];
      } catch (e: any) {
        // RPC or contract read fallback
      }

      const rootMatches =
        onchainRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000' &&
        onchainRoot.toLowerCase() === tree.root.toLowerCase();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                missionId: mission_id,
                missionIdBytes32: missionIdBytes,
                computedMerkleRoot: tree.root,
                payeeCount: tree.payees.length,
                onchain: {
                  treasuryAddress: treasury_address,
                  missionPayeeRoot: onchainRoot,
                  exists: missionExists,
                  closed: missionClosed,
                  capAtomic: onchainCap.toString(),
                  rootMatches,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
