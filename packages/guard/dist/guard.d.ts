import { MissionGuardConfig, Proposal, ValidationResult, SimulateOnChainResult } from './types.js';
import { PayeeMerkleTreeResult } from './merkle.js';
import { TaintRegistry } from './taint.js';
export declare const DEFAULT_FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
export declare const DEFAULT_TREASURY_ADDRESS: `0x${string}`;
export declare const DEFAULT_AGENT_ADDRESS: `0x${string}`;
export declare const proposeWithProofAbi: {
    readonly name: "proposeWithProof";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "operationId";
    }, {
        readonly type: "address";
        readonly name: "to";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "bytes32";
        readonly name: "missionId";
    }, {
        readonly type: "string";
        readonly name: "reason";
    }, {
        readonly type: "bytes32[]";
        readonly name: "proof";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
};
export interface MissionGuard {
    readonly config: MissionGuardConfig;
    readonly merkleTree: PayeeMerkleTreeResult;
    checkPayment(proposal: Proposal, taintRegistry?: TaintRegistry, spentTotal?: bigint): ValidationResult;
    buildProof(payeeAddress: string): `0x${string}`[] | null;
    getMerkleRoot(): `0x${string}`;
    simulateOnChain(proposal: Proposal, proof?: `0x${string}`[]): Promise<SimulateOnChainResult>;
}
export declare function createMissionGuard(config: MissionGuardConfig): MissionGuard;
//# sourceMappingURL=guard.d.ts.map