"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missionPayeeRootAbi = exports.missionsAbi = void 0;
exports.createMissionPayMcpServer = createMissionPayMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const guard_1 = require("@missionpay/guard");
const viem_1 = require("viem");
exports.missionsAbi = (0, viem_1.parseAbiItem)('function missions(bytes32 missionId) external view returns (bytes32 id, address agent, uint256 cap, uint256 expiresAt, bool exists, bool closed)');
exports.missionPayeeRootAbi = (0, viem_1.parseAbiItem)('function missionPayeeRoot(bytes32 missionId) external view returns (bytes32)');
function createMissionPayMcpServer() {
    const server = new mcp_js_1.McpServer({
        name: 'missionpay-mcp',
        version: '0.1.0',
    });
    // Tool 1: missionpay_check_payment
    server.tool('missionpay_check_payment', 'Validate payment proposal against deterministic dual-layer Merkle guard and provenance taint registry without executing on-chain', {
        mission_id: zod_1.z.string().describe('Mission ID or slug (e.g. "mission-research-01")'),
        to: zod_1.z.string().describe('Recipient EVM address (0x...)'),
        amount_atomic: zod_1.z.string().describe('Payment amount in atomic units (6 decimals for USDC, e.g. "1000000" = 1.00 USDC)'),
        reason: zod_1.z.string().describe('Payment purpose, contractor description or invoice memo (max 200 UTF-8 bytes)'),
        payees: zod_1.z.array(zod_1.z.string()).optional().describe('Owner-signed authorized payee addresses for this mission'),
        untrusted_texts: zod_1.z.array(zod_1.z.string()).optional().describe('Raw texts from web pages or untrusted tool outputs to check for injected recipients/amounts'),
        per_tx_cap_atomic: zod_1.z.string().optional().describe('Optional per-transaction cap in atomic units (default: 2000000 = 2 USDC)'),
        mission_cap_atomic: zod_1.z.string().optional().describe('Optional total mission budget cap in atomic units (default: 10000000 = 10 USDC)'),
    }, async ({ mission_id, to, amount_atomic, reason, payees = [], untrusted_texts = [], per_tx_cap_atomic = '2000000', mission_cap_atomic = '10000000', }) => {
        const taint = new guard_1.TaintRegistry();
        for (const text of untrusted_texts) {
            taint.record(text, 'WEB');
        }
        const guard = (0, guard_1.createMissionGuard)({
            missionId: mission_id,
            payees,
            caps: {
                perTxCapAtomic: BigInt(per_tx_cap_atomic),
                missionCapAtomic: BigInt(mission_cap_atomic),
            },
        });
        const proposal = {
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
                    text: JSON.stringify({
                        outcome: result.outcome,
                        rule: result.rule,
                        reason: result.reason,
                        toProvenance: result.toProvenance,
                        amountProvenance: result.amountProvenance,
                        payeeAuthorizedInRoot: result.outcome === 'PASS',
                    }, null, 2),
                },
            ],
        };
    });
    // Tool 2: missionpay_propose_payout
    server.tool('missionpay_propose_payout', 'Build a cryptographically verifiable payout proposal and generate the required OpenZeppelin Merkle proof for GuardedTreasury.proposeWithProof. This tool generates proposals and proofs; it NEVER holds, accesses, or requires private keys.', {
        mission_id: zod_1.z.string().describe('Mission ID or slug'),
        to: zod_1.z.string().describe('Recipient EVM address (0x...)'),
        amount_atomic: zod_1.z.string().describe('Payment amount in atomic units (6 decimals for USDC)'),
        reason: zod_1.z.string().describe('Payment purpose or invoice memo (max 200 UTF-8 bytes)'),
        payees: zod_1.z.array(zod_1.z.string()).optional().describe('Owner-signed authorized payee addresses for this mission'),
        untrusted_texts: zod_1.z.array(zod_1.z.string()).optional().describe('Raw texts from web pages or untrusted tool outputs to check for injected recipients/amounts'),
        operation_id: zod_1.z.string().optional().describe('Unique client operation ID (bytes32 hex or string; auto-generated if omitted)'),
    }, async ({ mission_id, to, amount_atomic, reason, payees = [], untrusted_texts = [], operation_id, }) => {
        const taint = new guard_1.TaintRegistry();
        for (const text of untrusted_texts) {
            taint.record(text, 'WEB');
        }
        const guard = (0, guard_1.createMissionGuard)({
            missionId: mission_id,
            payees,
        });
        const proposal = {
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
                        text: JSON.stringify({
                            status: 'REJECTED_BY_GUARD',
                            outcome: check.outcome,
                            rule: check.rule,
                            reason: check.reason,
                            toProvenance: check.toProvenance,
                            proof: [],
                        }, null, 2),
                    },
                ],
            };
        }
        const proof = guard.buildProof(to) || [];
        const opId = operation_id && operation_id.startsWith('0x') && operation_id.length === 66
            ? operation_id
            : (0, viem_1.keccak256)((0, viem_1.stringToBytes)(operation_id || `mcp-payout-${mission_id}-${Date.now()}-${Math.random()}`));
        let missionIdBytes32;
        if (mission_id.startsWith('0x') && mission_id.length === 66) {
            missionIdBytes32 = mission_id;
        }
        else {
            missionIdBytes32 = (0, viem_1.keccak256)((0, viem_1.stringToBytes)(mission_id));
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'READY_TO_SUBMIT',
                        outcome: 'PASS',
                        proposal: {
                            operationId: opId,
                            to: (0, guard_1.normalizeAddress)(to),
                            amountAtomic: amount_atomic,
                            missionId: missionIdBytes32,
                            reason: reason.slice(0, 200),
                        },
                        merkleRoot: guard.getMerkleRoot(),
                        proof,
                        contractTarget: guard_1.DEFAULT_TREASURY_ADDRESS,
                        calldataFunction: 'proposeWithProof(bytes32,address,uint256,bytes32,string,bytes32[])',
                        securityNotice: 'Proposal and cryptographic Merkle proof generated successfully. Submit via your preferred agent signer or smart wallet.',
                    }, null, 2),
                },
            ],
        };
    });
    // Tool 3: missionpay_verify_mission
    server.tool('missionpay_verify_mission', 'Inspects on-chain mission state and Merkle root on Avalanche Fuji C-Chain, verifying whether a mission is active and computing its cryptographic root.', {
        mission_id: zod_1.z.string().describe('Mission ID or slug'),
        payees: zod_1.z.array(zod_1.z.string()).optional().describe('List of payee addresses to compute and verify against the on-chain Merkle root'),
        rpc_url: zod_1.z.string().optional().describe('Avalanche RPC URL (defaults to Avalanche Fuji Testnet)'),
        treasury_address: zod_1.z.string().optional().describe('GuardedTreasury contract address'),
    }, async ({ mission_id, payees = [], rpc_url = guard_1.DEFAULT_FUJI_RPC, treasury_address = guard_1.DEFAULT_TREASURY_ADDRESS, }) => {
        let missionIdBytes;
        if (mission_id.startsWith('0x') && mission_id.length === 66) {
            missionIdBytes = mission_id;
        }
        else {
            missionIdBytes = (0, viem_1.keccak256)((0, viem_1.stringToBytes)(mission_id));
        }
        const tree = (0, guard_1.computePayeeMerkleTree)(payees);
        const client = (0, viem_1.createPublicClient)({
            transport: (0, viem_1.http)(rpc_url),
        });
        let onchainRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';
        let missionExists = false;
        let missionClosed = false;
        let onchainCap = 0n;
        try {
            const root = (await client.readContract({
                address: treasury_address,
                abi: [exports.missionPayeeRootAbi],
                functionName: 'missionPayeeRoot',
                args: [missionIdBytes],
            }));
            onchainRoot = root;
            const missionData = (await client.readContract({
                address: treasury_address,
                abi: [exports.missionsAbi],
                functionName: 'missions',
                args: [missionIdBytes],
            }));
            missionExists = missionData[4];
            missionClosed = missionData[5];
            onchainCap = missionData[2];
        }
        catch (e) {
            // RPC or contract read fallback
        }
        const rootMatches = onchainRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000' &&
            onchainRoot.toLowerCase() === tree.root.toLowerCase();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
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
                    }, null, 2),
                },
            ],
        };
    });
    return server;
}
//# sourceMappingURL=server.js.map