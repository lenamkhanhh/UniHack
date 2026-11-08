import { Proposal } from './types.js';
export declare class TaintRegistry {
    private taintedAddresses;
    private taintedAmounts;
    record(text: string, source?: 'TOOL_OUTPUT' | 'WEB'): void;
    isAddressTainted(address: string): boolean;
    getAddressSource(address: string): 'TOOL_OUTPUT' | 'WEB' | undefined;
    isAmountTainted(amountAtomicOrDecimal: string): boolean;
    getTaintedAddresses(): string[];
}
export declare function isPolicyChangeAttempt(proposal: Proposal): boolean;
//# sourceMappingURL=taint.d.ts.map