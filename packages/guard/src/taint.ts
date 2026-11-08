import { Proposal } from './types.js';

export class TaintRegistry {
  private taintedAddresses: Map<string, 'TOOL_OUTPUT' | 'WEB'> = new Map();
  private taintedAmounts: Set<string> = new Set();

  record(text: string, source: 'TOOL_OUTPUT' | 'WEB' = 'TOOL_OUTPUT'): void {
    if (!text || typeof text !== 'string') return;

    // Normalize and match addresses (0x or 0X followed by 40 hex chars)
    const matches = text.match(/0x[a-f0-9]{40}/gi);
    if (matches) {
      for (const m of matches) {
        this.taintedAddresses.set(m.toLowerCase(), source);
      }
    }

    // Match numbers and currency values (e.g. $3, 3 USDC, 3.00, 50, 500)
    const amtMatches = text.match(/(?:\$|USDC\s*|USD\s*)?(\d+(?:\.\d+)?)/gi);
    if (amtMatches) {
      for (const raw of amtMatches) {
        const cleaned = raw.replace(/[^\d.]/g, '');
        if (cleaned) {
          this.taintedAmounts.add(cleaned);
          const parts = cleaned.split('.');
          const whole = parts[0];
          const frac = (parts[1] || '').padEnd(6, '0').slice(0, 6);
          try {
            const atomic = (BigInt(whole) * 1_000_000n + BigInt(frac)).toString();
            this.taintedAmounts.add(atomic);
          } catch {}
        }
      }
    }
  }

  isAddressTainted(address: string): boolean {
    if (!address) return false;
    const clean = address.startsWith('0x') || address.startsWith('0X') ? address.toLowerCase() : `0x${address}`.toLowerCase();
    return this.taintedAddresses.has(clean);
  }

  getAddressSource(address: string): 'TOOL_OUTPUT' | 'WEB' | undefined {
    if (!address) return undefined;
    const clean = address.startsWith('0x') || address.startsWith('0X') ? address.toLowerCase() : `0x${address}`.toLowerCase();
    return this.taintedAddresses.get(clean);
  }

  isAmountTainted(amountAtomicOrDecimal: string): boolean {
    if (!amountAtomicOrDecimal) return false;
    return this.taintedAmounts.has(amountAtomicOrDecimal);
  }

  getTaintedAddresses(): string[] {
    return Array.from(this.taintedAddresses.keys());
  }
}

export function isPolicyChangeAttempt(proposal: Proposal): boolean {
  // Scoped evaluation: only evaluate payout reason and tool_id with word boundaries
  if (proposal.kind === 'treasury_payout') {
    const reasonText = (proposal.reason || '').toLowerCase();
    const policyKeywords = /(?:^|[\s.,;:!?()"'`])(?:set|change|update|raise|increase|bypass|override|nâng|tăng|đổi|sửa)\b(?:\s+(?:the\s+)?(?:daily|per[_\-\s]*tx|mission|spending|tool|treasury)?\s*(?:cap|limit|allowlist|payee[_\-\s]*root|root|pause|policy|hạn\s*mức|giới\s*hạn|ngân\s*sách)(?:$|[\s.,;:!?()"'`]))/i;
    const adminKeywords = /\b(?:setcaps|setrecipient|setmissioncap|setmissionpayeeroot|pause|unpause)\b/i;

    if (policyKeywords.test(reasonText) || adminKeywords.test(reasonText)) {
      return true;
    }
  }

  if (proposal.kind === 'tool_purchase') {
    const toolId = (proposal.tool_id || '').toLowerCase();
    const adminToolKeywords = /(?:^|[_\-\s])(?:policy|cap|admin|setcaps|setrecipient|setmissioncap|setmissionpayeeroot|pause|unpause)(?:$|[_\-\s])/i;
    if (adminToolKeywords.test(toolId)) {
      return true;
    }
  }

  return false;
}
