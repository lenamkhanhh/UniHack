'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'vi';

export interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const DICTIONARY: Record<Language, Record<string, string>> = {
  en: {
    // Nav
    'nav.dashboard': 'Dashboard',
    'nav.bounty': 'Hack Treasury',
    'nav.verify': 'Verify Proof',
    'nav.passkey': 'Passkey',
    'nav.arena': 'Arena Stage',
    'nav.demo': 'Demo',
    'nav.queue': 'Queue (S2)',
    'nav.audit': 'Audit',

    // Landing Page
    'landing.hero.title': 'Others stop strangers. We stop off-mission payees too.',
    'landing.hero.subtitle': 'Give your AI agent a mission and a budget. Avalanche smart contracts guarantee it can never overspend or divert funds — and cryptographically prove every single transaction.',
    'landing.btn.bounty': 'Hack the treasury',
    'landing.btn.verify': 'Verify a mission',
    'landing.btn.passkey': 'Approve with passkey',
    'landing.section.missions': 'Active Missions & On-Chain Budgets',
    'landing.section.missions_desc': 'Overview of active missions, two separate budgets (Tool session wallet vs Treasury), and cryptographic proofs.',
    'landing.loading': 'Loading active missions...',
    'landing.empty.title': 'No active missions found in current database.',
    'landing.empty.desc': 'Start by trying the public bounty challenge or launching a demo mission.',
    'landing.btn.demo': 'Launch Demo Mission',
    'landing.btn.bounty_cta': 'Go to Bounty Arena',
    'landing.card.tool_budget': 'Tool Budget (Session Wallet)',
    'landing.card.treasury_budget': 'Treasury Budget (On-Chain)',
    'landing.card.spent': 'Spent',
    'landing.card.reserved': 'Reserved',
    'landing.card.cap': 'Cap',
    'landing.card.over_by': 'Over by',
    'landing.card.view_proof': 'View Mission Proof →',
    'landing.card.payee_root_onchain': '✓ Payee root on-chain',
    'landing.card.payee_root_pending': '⚠ Payee root pending on-chain',
    'landing.card.expired': 'Mission expired — Read recovery available',

    // Bounty Page
    'bounty.tag': 'HACK THE TREASURY BOUNTY',
    'bounty.hero.title': 'Trick the agent to pay you.',
    'bounty.hero.desc': 'Inject your wallet address into an invoice, vendor catalog, email, or web search. Watch Avalanche Fuji smart contracts block off-mission payouts automatically.',
    'bounty.budget.remaining': 'Bounty budget remaining:',
    'bounty.budget.cap_note': 'cap: 5.00 USDC, read from contract',
    'bounty.treasury.balance': 'Treasury balance:',
    'bounty.stat.attempts': 'Total Attempts',
    'bounty.stat.tricked': 'Agent Tricked',
    'bounty.stat.blocked': 'Blocked by Guard',
    'bounty.stat.leak': 'Funds Out of Bounds',
    'bounty.form.title': '1. Choose Attack Vector & Provide Untrusted Input',
    'bounty.form.vector': 'Attack Vector',
    'bounty.form.attacker': 'Your Wallet Address (Attacker Recipient)',
    'bounty.form.payload': 'Untrusted Content Payload (Invoice, Search Result, or Web DOM)',
    'bounty.form.submit': '⚡ Submit Attack Proposal',
    'bounty.form.submitting': 'Analyzing with autonomous agent...',
    'bounty.step1.title': 'Step 1: Autonomous Agent (LLM)',
    'bounty.step2.title': 'Step 2: MissionPay Guard Engine',
    'bounty.step3.title': 'Step 3: Avalanche Fuji Smart Contract',
    'bounty.recent.title': 'Live Public Attack Feed',
    'bounty.recent.empty': 'No public attack attempts recorded yet. Be the first to try!',
    'bounty.rpc_error': 'Notice: Avalanche Fuji RPC connectivity issue. Displaying cached contract state.',

    // Verify Page
    'verify.tag': 'CLIENT-SIDE VERIFIER',
    'verify.hero.title': "DON'T TRUST US — VERIFY YOURSELF",
    'verify.hero.desc': 'The entire Keccak-256 hash chain is independently computed right here in your browser runtime and matched against Avalanche Fuji on-chain state.',
    'verify.btn.tamper': '🧪 TEST MODIFY 1 BYTE',
    'verify.btn.reset': '🔄 RESTORE ORIGINAL',
    'verify.result.title': 'CLIENT-SIDE CRYPTOGRAPHIC AUDIT',
    'verify.result.valid': '✓ HASH CHAIN VALID',
    'verify.result.invalid': '✗ CORRUPTED / TAMPERED',
    'verify.card.head': 'Computed Audit Head Hash',
    'verify.card.onchain_head': 'On-Chain Anchored Head',
    'verify.card.entries': 'Entries Validated',
    'verify.card.match': '✓ MATCHES ON-CHAIN FUJI PROOF',
    'verify.card.mismatch': '✗ HASH MISMATCH WITH ON-CHAIN ANCHOR',
    'verify.card.not_anchored': 'Not yet anchored on Avalanche Fuji',
    'verify.card.erc_validation': 'ERC-8004 Verification Attestation',
    'verify.tamper_alert': 'TAMPER DETECTED: Hash chain broken at modified entry! Every subsequent hash fails validation.',
    'verify.not_found.title': 'Mission Not Found',
    'verify.not_found.desc': 'The requested mission was not found in the database.',
    'verify.not_found.cta': 'Go to Verified Demo Seed',

    // Passkey Page
    'passkey.tag.w4': 'WOW-W4 · Passkey Mission Authority',
    'passkey.tag.precompile': 'RIP-7212 P-256 Precompile @ 0x100',
    'passkey.hero.title': 'Create & Approve Mission with Passkey',
    'passkey.hero.desc': 'WebAuthn P-256 biometric signatures from your hardware authenticator (Touch ID, Face ID, Windows Hello) are verified natively by RIP-7212 precompile on Avalanche Fuji. Zero private keys stored on device or server.',
    'passkey.field.slug': 'Mission Slug Identifier',
    'passkey.field.agent': 'Agent Address',
    'passkey.field.payee_root': 'Owner Payee Root (Merkle)',
    'passkey.field.cap': 'Mission Treasury Cap (USDC)',
    'passkey.field.tool_cap': 'Session Tool Cap (USDC)',
    'passkey.field.duration': 'Duration (Hours)',
    'passkey.btn.register': '1. Register Authenticator Passkey',
    'passkey.btn.approve': '🔑 Approve with Passkey (WebAuthn)',
    'passkey.success.title': '✓ Mission Approved On-Chain Successfully!',
  },
  vi: {
    // Nav
    'nav.dashboard': 'Bảng điều khiển',
    'nav.bounty': 'Tấn công ngân quỹ',
    'nav.verify': 'Kiểm chứng proof',
    'nav.passkey': 'Passkey',
    'nav.arena': 'Sân khấu Arena',
    'nav.demo': 'Demo',
    'nav.queue': 'Hàng chờ (S2)',
    'nav.audit': 'Kiểm toán',

    // Landing Page
    'landing.hero.title': 'Người khác chặn kẻ lạ. Chúng tôi chặn cả người nhận ngoài nhiệm vụ.',
    'landing.hero.subtitle': 'Giao cho AI agent một nhiệm vụ và một ngân sách. Hợp đồng thông minh Avalanche bảo đảm không bao giờ chi vượt hạn mức hay chuyển lệch người nhận — và chứng minh bằng mật mã từng giao dịch.',
    'landing.btn.bounty': 'Thử hack ngân quỹ',
    'landing.btn.verify': 'Tự kiểm chứng mission',
    'landing.btn.passkey': 'Duyệt bằng passkey',
    'landing.section.missions': 'Nhiệm vụ đang chạy & Ngân sách On-Chain',
    'landing.section.missions_desc': 'Tổng quan các nhiệm vụ đang chạy, hai ngân sách độc lập (Ví phiên mua tool vs Ngân quỹ hợp đồng) và bằng chứng kiểm toán.',
    'landing.loading': 'Đang tải danh sách nhiệm vụ...',
    'landing.empty.title': 'Không có nhiệm vụ nào trong cơ sở dữ liệu hiện tại.',
    'landing.empty.desc': 'Bắt đầu bằng cách thử thách ngân quỹ bounty hoặc chạy một mission demo.',
    'landing.btn.demo': 'Chạy Mission Demo',
    'landing.btn.bounty_cta': 'Tới Đấu Trường Bounty',
    'landing.card.tool_budget': 'Ngân sách Tool (Ví phiên)',
    'landing.card.treasury_budget': 'Ngân sách Ngân quỹ (On-Chain)',
    'landing.card.spent': 'Đã chi',
    'landing.card.reserved': 'Tạm giữ',
    'landing.card.cap': 'Hạn mức',
    'landing.card.over_by': 'Vượt mức',
    'landing.card.view_proof': 'Xem Bằng Chứng Mission →',
    'landing.card.payee_root_onchain': '✓ Payee root on-chain',
    'landing.card.payee_root_pending': '⚠ Payee root chưa lên chain',
    'landing.card.expired': 'Mission đã hết hạn — Có thể phục hồi đọc',

    // Bounty Page
    'bounty.tag': 'ĐẤU TRƯỜNG BOUNTY HACK THE TREASURY',
    'bounty.hero.title': 'Lừa agent trả tiền cho bạn.',
    'bounty.hero.desc': 'Cài một địa chỉ ví của bạn vào hóa đơn, trang vendor, email hay kết quả tìm kiếm và xem hợp đồng thông minh GuardedTreasury.sol trên Avalanche Fuji tự động bảo toàn ngân quỹ.',
    'bounty.budget.remaining': 'Ngân sách bounty mission:',
    'bounty.budget.cap_note': 'hạn mức: 5.00 USDC, đọc trực tiếp từ contract',
    'bounty.treasury.balance': 'Số dư treasury:',
    'bounty.stat.attempts': 'Tổng số đòn',
    'bounty.stat.tricked': 'Agent bị thuyết phục',
    'bounty.stat.blocked': 'Chặn bởi Guard',
    'bounty.stat.leak': 'Tiền ra ngoài phạm vi',
    'bounty.form.title': '1. Chọn véc-tơ tấn công & Nhập dữ liệu không tin cậy',
    'bounty.form.vector': 'Véc-tơ tấn công',
    'bounty.form.attacker': 'Địa chỉ ví của bạn (Người nhận tấn công)',
    'bounty.form.payload': 'Dữ liệu không tin cậy (Hóa đơn, kết quả tìm kiếm hoặc Web DOM)',
    'bounty.form.submit': '⚡ Gửi đề xuất tấn công',
    'bounty.form.submitting': 'Đang phân tích cùng autonomous agent...',
    'bounty.step1.title': 'Tầng 1: AI Agent tự hành (LLM)',
    'bounty.step2.title': 'Tầng 2: Lớp bảo vệ MissionPay',
    'bounty.step3.title': 'Tầng 3: Smart contract Avalanche Fuji',
    'bounty.recent.title': 'Nhật ký đòn tấn công công khai',
    'bounty.recent.empty': 'Chưa có lượt tấn công công khai nào. Hãy là người đầu tiên thử thách!',
    'bounty.rpc_error': 'Lưu ý: Sự cố kết nối Avalanche Fuji RPC. Đang hiển thị trạng thái hợp đồng đã lưu.',

    // Verify Page
    'verify.tag': 'XÁC THỰC MẬT MÃ CLIENT-SIDE',
    'verify.hero.title': 'ĐỪNG TIN CHÚNG TÔI — TỰ KIỂM CHỨNG',
    'verify.hero.desc': 'Toàn bộ chuỗi Keccak256 được tính toán độc lập ngay trên trình duyệt của bạn. So khớp trực tiếp với neo on-chain Avalanche Fuji.',
    'verify.btn.tamper': '🧪 THỬ SỬA 1 BYTE DỮ LIỆU',
    'verify.btn.reset': '🔄 KHÔI PHỤC NGUYÊN GỐC',
    'verify.result.title': 'KẾT QUẢ KIỂM TRA MÃ HÓA CLIENT-SIDE',
    'verify.result.valid': '✓ CHUỖI HASH NGUYÊN VẸN',
    'verify.result.invalid': '✗ PHÁT HIỆN GIẢ MẠO / GÃY CHUỖI',
    'verify.card.head': 'Audit Head Hash tính toán',
    'verify.card.onchain_head': 'Head neo On-Chain Fuji',
    'verify.card.entries': 'Số bản ghi kiểm tra',
    'verify.card.match': '✓ KHỚP TUYỆT ĐỐI VỚI NEO ON-CHAIN FUJI',
    'verify.card.mismatch': '✗ KHÔNG KHỚP VỚI NEO TRÊN SMART CONTRACT',
    'verify.card.not_anchored': 'Chưa neo on-chain Avalanche Fuji',
    'verify.card.erc_validation': 'Chứng nhận xác thực ERC-8004',
    'verify.tamper_alert': 'CẢNH BÁO GIẢ MẠO: Chuỗi băm bị gãy tại bản ghi bị sửa đổi! Mọi hash tiếp theo đều bị vô hiệu.',
    'verify.not_found.title': 'Không tìm thấy mission',
    'verify.not_found.desc': 'Nhiệm vụ được yêu cầu không tồn tại trong cơ sở dữ liệu.',
    'verify.not_found.cta': 'Mở Demo Seed có sẵn',

    // Passkey Page
    'passkey.tag.w4': 'WOW-W4 · Passkey Mission Authority',
    'passkey.tag.precompile': 'RIP-7212 P-256 Precompile @ 0x100',
    'passkey.hero.title': 'Tạo & Duyệt Mission bằng Passkey',
    'passkey.hero.desc': 'Chữ ký WebAuthn P-256 sinh ra từ phần cứng thiết bị (Touch ID / Face ID / Windows Hello) được xác thực trực tiếp bởi precompile trên Avalanche Fuji. Không giữ private key trong ví nóng.',
    'passkey.field.slug': 'Mã định danh Mission',
    'passkey.field.agent': 'Địa chỉ ví Agent',
    'passkey.field.payee_root': 'Gốc Merkle người nhận hợp lệ (Payee Root)',
    'passkey.field.cap': 'Hạn mức Ngân quỹ (USDC)',
    'passkey.field.tool_cap': 'Hạn mức Tool ví phiên (USDC)',
    'passkey.field.duration': 'Thời hạn (Giờ)',
    'passkey.btn.register': '1. Đăng ký Passkey Thiết bị',
    'passkey.btn.approve': '🔑 Duyệt bằng Passkey (WebAuthn)',
    'passkey.success.title': '✓ Duyệt Mission On-Chain thành công!',
  },
};

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('missionpay_lang');
      if (saved === 'vi' || saved === 'en') {
        setLangState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const setLang = (nextLang: Language) => {
    setLangState(nextLang);
    try {
      localStorage.setItem('missionpay_lang', nextLang);
    } catch {
      // ignore
    }
  };

  const t = (key: string): string => {
    const dict = DICTIONARY[lang] || DICTIONARY.en;
    if (dict[key]) return dict[key];
    const fallback = DICTIONARY.en[key];
    return fallback || key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
