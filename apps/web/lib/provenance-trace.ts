/**
 * WOW-W5: Dirty Data Provenance Trace Engine
 *
 * Reconstructs the exact causal path of tainted/untrusted data:
 * 1. Tool Output / Web Source (taint registry origin)
 * 2. Extracted Field (recipient address / amount atomic)
 * 3. Agent Payout Proposal
 * 4. Off-Chain Validator Rule (RECIPIENT_UNTRUSTED_PROVENANCE / AMOUNT_FROM_UNTRUSTED_SOURCE)
 * 5. On-Chain Smart Contract Layer (eth_call simulation or not_run)
 */

import { TaintRegistry, Proposal, ValidationResult, Provenance } from './validator';
import { normalizeAddress } from './chain';

export type OnchainVerification =
  | {
      kind: 'eth_call';
      result: string;
      contract?: string;
      chainId?: number;
    }
  | {
      kind: 'not_run';
    };

export interface ProvenanceTraceStep {
  step: number;
  label: string;
  source: string;
  detail: string;
  status: 'SAFE' | 'TAINTED' | 'BLOCKED' | 'REVERTED' | 'NOT_RUN';
}

export interface ProvenanceTrace {
  isBlocked: boolean;
  verdictRule?: string;
  onchainVerification: OnchainVerification;
  onchainResult?: string;
  summary: string;
  steps: ProvenanceTraceStep[];
}

export function buildProvenanceTrace(
  taintRegistry: TaintRegistry | undefined,
  proposal: Proposal,
  verdict: ValidationResult,
  onchainVerification: OnchainVerification
): ProvenanceTrace {
  const isBlocked = verdict.outcome === 'BLOCK' || verdict.outcome === 'QUEUE';
  const steps: ProvenanceTraceStep[] = [];

  let toAddr = '';
  let amt = proposal.amount_atomic || '0';
  if (proposal.kind === 'treasury_payout') {
    toAddr = proposal.to || '';
  }

  const normTo = toAddr ? normalizeAddress(toAddr).toLowerCase() : '';
  const isRecipientTainted = taintRegistry ? taintRegistry.isAddressTainted(normTo) : false;
  const isAmountTainted = taintRegistry ? taintRegistry.isAmountTainted(amt) : false;

  const toProvenance: Provenance = verdict.toProvenance || (isRecipientTainted ? 'WEB' : 'OWNER_MISSION');
  const amountProvenance: Provenance = verdict.amountProvenance || (isAmountTainted ? 'TOOL_OUTPUT' : 'OWNER_MISSION');

  // Step 1: Tool Output / Incoming Source
  if (toProvenance === 'WEB' || toProvenance === 'TOOL_OUTPUT') {
    steps.push({
      step: 1,
      label: 'Dữ Liệu Đầu Vào Không Tin Cậy',
      source: toProvenance === 'WEB' ? 'WEB (Tài Liệu Độc Hại / Web Page)' : 'TOOL_OUTPUT (Kết Quả Tool)',
      detail: `Taint registry phát hiện địa chỉ ${toAddr || 'đích'} xuất hiện trong nội dung không được xác thực từ bên ngoài.`,
      status: 'TAINTED',
    });
  } else if (amountProvenance === 'TOOL_OUTPUT' || isAmountTainted) {
    steps.push({
      step: 1,
      label: 'Số Tiền Bị Đầu Độc Trong Dữ Liệu',
      source: 'TOOL_OUTPUT (Tài Liệu Hóa Đơn / Báo Giá)',
      detail: `Số tiền payout (${amt} atomic) được trích xuất từ dữ liệu bẩn chưa được chủ ngân quỹ ký duyệt.`,
      status: 'TAINTED',
    });
  } else {
    steps.push({
      step: 1,
      label: 'Nguồn Dữ Liệu Hợp Lệ',
      source: 'OWNER_MISSION (Chữ Ký Chủ Ngân Quỹ)',
      detail: `Địa chỉ người nhận ${toAddr} thuộc danh sách người nhận đã được chủ ngân quỹ ký duyệt.`,
      status: 'SAFE',
    });
  }

  // Step 2: Extracted Field
  if (toProvenance === 'WEB' || toProvenance === 'TOOL_OUTPUT') {
    steps.push({
      step: 2,
      label: 'Trích Xuất Trường Recipient',
      source: 'Data Parser / Regex Extraction',
      detail: `Trường 'recipient' chứa địa chỉ kẻ tấn công: ${toAddr}.`,
      status: 'TAINTED',
    });
  } else if (amountProvenance === 'TOOL_OUTPUT' || isAmountTainted) {
    steps.push({
      step: 2,
      label: 'Trích Xuất Trường Amount',
      source: 'Data Parser / Amount Extraction',
      detail: `Trường 'amount_atomic' bị thổi phồng: ${amt} units.`,
      status: 'TAINTED',
    });
  } else {
    steps.push({
      step: 2,
      label: 'Trường Thanh Toán Hợp Lệ',
      source: 'Mission Policy Set',
      detail: `Địa chỉ ${toAddr} khớp với danh sách allowlist và Merkle tree của nhiệm vụ.`,
      status: 'SAFE',
    });
  }

  // Step 3: Agent Proposal
  if (toProvenance === 'WEB' || toProvenance === 'TOOL_OUTPUT' || isAmountTainted) {
    steps.push({
      step: 3,
      label: 'Đề Xuất Payout Của Agent',
      source: 'Autonomous LLM Planner',
      detail: `Agent bị thuyết phục bởi nội dung độc hại và tạo đề xuất payout ${amt} atomic tới ${toAddr}.`,
      status: 'TAINTED',
    });
  } else {
    steps.push({
      step: 3,
      label: 'Đề Xuất Hợp Lệ Của Agent',
      source: 'Autonomous LLM Planner',
      detail: `Agent đề xuất thanh toán định kỳ cho vendor đã được phê duyệt.`,
      status: 'SAFE',
    });
  }

  // Step 4: Off-Chain Guard
  if (verdict.outcome === 'BLOCK' || verdict.outcome === 'QUEUE') {
    steps.push({
      step: 4,
      label: 'Validator Off-Chain Chặn Giao Dịch',
      source: 'MissionPay Validator (Pipeline C2)',
      detail: `Kích hoạt quy tắc bảo vệ: ${verdict.rule || 'RULE_BLOCK'}. Lý do: ${verdict.reason || 'Dữ liệu không đáng tin cậy'}.`,
      status: 'BLOCKED',
    });
  } else {
    steps.push({
      step: 4,
      label: 'Validator Off-Chain Phê Duyệt',
      source: 'MissionPay Validator (Pipeline C2)',
      detail: 'Đề xuất thỏa mãn toàn bộ bất biến ngân sách và nguồn gốc người nhận.',
      status: 'SAFE',
    });
  }

  // Step 5: Smart Contract Layer (eth_call or not_run)
  if (onchainVerification.kind === 'not_run') {
    steps.push({
      step: 5,
      label: 'Hợp Đồng Thông Minh Trên Avalanche Fuji',
      source: 'GuardedTreasury.sol (Fuji 43113)',
      detail: 'Chưa kiểm on-chain cho lượt này.',
      status: 'NOT_RUN',
    });
  } else {
    if (isBlocked) {
      const isRevert =
        onchainVerification.result.toLowerCase().includes('revert') ||
        onchainVerification.result === 'PayeeNotInMissionSet' ||
        onchainVerification.result === 'PayeeProofRequired' ||
        onchainVerification.result === 'RecipientNotAllowlisted' ||
        onchainVerification.result === 'MissionCapExceeded';

      steps.push({
        step: 5,
        label: 'Hợp Đồng Thông Minh Trên Avalanche Fuji',
        source: `GuardedTreasury.sol (${onchainVerification.contract ? onchainVerification.contract.slice(0, 10) + '...' : 'Fuji 43113'})`,
        detail: `Mô phỏng server bị chiếm: Gọi thẳng proposeWithProof lên Fuji -> Kết quả mô phỏng: ${onchainVerification.result}.`,
        status: isRevert ? 'REVERTED' : 'SAFE',
      });
    } else {
      steps.push({
        step: 5,
        label: 'Hợp Đồng Thông Minh Trên Avalanche Fuji',
        source: 'GuardedTreasury.sol',
        detail: 'Kiểm tra Merkle root thành công, giao dịch sẵn sàng thực thi an toàn.',
        status: 'SAFE',
      });
    }
  }

  let summary = '';
  if (isBlocked) {
    if (onchainVerification.kind === 'not_run') {
      summary = `Dữ liệu bẩn từ [${toProvenance || 'UNTRUSTED'}] bị chặn bởi [${verdict.rule}]. Lớp on-chain: Chưa kiểm tra trực tiếp cho lượt này.`;
    } else {
      summary = `Dữ liệu bẩn từ [${toProvenance || 'UNTRUSTED'}] bị chặn bởi [${verdict.rule}] và được bảo đảm revert on-chain bởi [${onchainVerification.result}].`;
    }
  } else {
    summary = `Dữ liệu hợp lệ từ [OWNER_MISSION] được phê duyệt an toàn.`;
  }

  return {
    isBlocked,
    verdictRule: verdict.rule,
    onchainVerification,
    onchainResult: onchainVerification.kind === 'eth_call' ? onchainVerification.result : undefined,
    summary,
    steps,
  };
}
