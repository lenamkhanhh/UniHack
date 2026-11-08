export type ProposalKind = 'tool_purchase' | 'treasury_payout';
export type Provenance = 'OWNER_MISSION' | 'ERC8004_VERIFIED' | 'TOOL_OUTPUT' | 'WEB' | 'LLM';
export interface BaseProposal {
    kind: ProposalKind;
    mission_id: string;
    amount_atomic: string;
    reason: string;
}
export interface ToolPurchaseProposal extends BaseProposal {
    kind: 'tool_purchase';
    tool_id: string;
    arguments: Record<string, any>;
}
export interface TreasuryPayoutProposal extends BaseProposal {
    kind: 'treasury_payout';
    to: string;
}
export type Proposal = ToolPurchaseProposal | TreasuryPayoutProposal;
export type ValidationRuleId = 'AGENT_CANNOT_CHANGE_POLICY' | 'SYSTEM_PAUSED' | 'MISSION_EXPIRED' | 'INVALID_RECIPIENT' | 'CANNOT_PAY_AGENT' | 'RECIPIENT_UNTRUSTED_PROVENANCE' | 'PAYEE_NOT_IN_MISSION_SET' | 'RECIPIENT_NEEDS_OWNER_APPROVAL' | 'RECIPIENT_NOT_ALLOWLISTED' | 'AMOUNT_FROM_UNTRUSTED_SOURCE' | 'OVER_PER_TX_CAP' | 'MISSION_CAP_EXHAUSTED' | 'VALIDATION_PASSED';
export type ValidationDecision = 'PASS' | 'BLOCK' | 'QUEUE';
export interface ValidationResult {
    outcome: ValidationDecision;
    rule?: ValidationRuleId | string;
    reason?: string;
    toProvenance?: Provenance;
    amountProvenance?: Provenance;
}
export type PayeeDefinition = string | {
    address: string;
    maxAtomic?: string | bigint;
};
export interface MissionCaps {
    perTxCapAtomic?: bigint | string;
    dailyCapAtomic?: bigint | string;
    missionCapAtomic?: bigint | string;
    toolCapAtomic?: bigint | string;
}
export interface MissionGuardConfig {
    missionId: string | `0x${string}`;
    payees: PayeeDefinition[];
    caps?: MissionCaps;
    globalAllowlist?: string[];
    rpcUrl?: string;
    treasuryAddress?: `0x${string}`;
    agentAddress?: string;
    isSystemPaused?: boolean;
}
export interface SimulateOnChainResult {
    success: boolean;
    resultOrError: string;
    revertReason?: string;
    proposalId?: bigint;
}
//# sourceMappingURL=types.d.ts.map