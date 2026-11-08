"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proposeWithProofAbi = exports.DEFAULT_AGENT_ADDRESS = exports.DEFAULT_TREASURY_ADDRESS = exports.DEFAULT_FUJI_RPC = void 0;
exports.createMissionGuard = createMissionGuard;
const viem_1 = require("viem");
const merkle_js_1 = require("./merkle.js");
const validator_js_1 = require("./validator.js");
exports.DEFAULT_FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
exports.DEFAULT_TREASURY_ADDRESS = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';
exports.DEFAULT_AGENT_ADDRESS = '0x374b8A126FDb9e5deEc8307da385076155Af3D72';
exports.proposeWithProofAbi = (0, viem_1.parseAbiItem)('function proposeWithProof(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string reason, bytes32[] proof) external returns (uint256)');
function createMissionGuard(config) {
    const merkleTree = (0, merkle_js_1.computePayeeMerkleTree)(config.payees || []);
    const guard = {
        config,
        merkleTree,
        checkPayment(proposal, taintRegistry, spentTotal = 0n) {
            return (0, validator_js_1.validateTreasuryProposal)(proposal, config, taintRegistry, spentTotal);
        },
        buildProof(payeeAddress) {
            return merkleTree.getProof(payeeAddress);
        },
        getMerkleRoot() {
            return merkleTree.root;
        },
        async simulateOnChain(proposal, proof) {
            if (proposal.kind !== 'treasury_payout') {
                return {
                    success: true,
                    resultOrError: 'TOOL_PURCHASE_OFFCHAIN_SETTLED',
                };
            }
            const payout = proposal;
            const rpcUrl = config.rpcUrl || process.env.AVALANCHE_FUJI_RPC || exports.DEFAULT_FUJI_RPC;
            const treasuryAddress = config.treasuryAddress || exports.DEFAULT_TREASURY_ADDRESS;
            const client = (0, viem_1.createPublicClient)({
                transport: (0, viem_1.http)(rpcUrl),
            });
            // Prepare bytes32 missionId
            let missionIdBytes;
            if (typeof config.missionId === 'string' && config.missionId.startsWith('0x') && config.missionId.length === 66) {
                missionIdBytes = config.missionId;
            }
            else {
                missionIdBytes = (0, viem_1.keccak256)((0, viem_1.stringToBytes)(String(config.missionId)));
            }
            // Compute proof if not provided
            const resolvedProof = proof || guard.buildProof(payout.to) || [];
            const operationId = (0, viem_1.keccak256)((0, viem_1.stringToBytes)(`op-${config.missionId}-${Date.now()}-${Math.random()}`));
            const toAddr = payout.to;
            const amountAtomic = BigInt(payout.amount_atomic);
            const callerAccount = config.agentAddress || exports.DEFAULT_AGENT_ADDRESS;
            try {
                const { result } = await client.simulateContract({
                    address: treasuryAddress,
                    abi: [exports.proposeWithProofAbi],
                    functionName: 'proposeWithProof',
                    args: [operationId, toAddr, amountAtomic, missionIdBytes, payout.reason.slice(0, 200), resolvedProof],
                    account: callerAccount,
                });
                return {
                    success: true,
                    resultOrError: 'SUCCESS',
                    proposalId: result,
                };
            }
            catch (err) {
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
//# sourceMappingURL=guard.js.map