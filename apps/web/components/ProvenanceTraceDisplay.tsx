'use client';

import React from 'react';
import { ProvenanceTrace } from '@/lib/provenance-trace';
import { useI18n } from '@/lib/i18n';

interface Props {
  trace: ProvenanceTrace;
}

export default function ProvenanceTraceDisplay({ trace }: Props) {
  const { lang } = useI18n();
  const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);

  const translateLabel = (label: string) => {
    if (lang === 'vi') return label;
    if (label.includes('Dữ Liệu Đầu Vào Không Tin Cậy')) return 'Untrusted Input Data';
    if (label.includes('Số Tiền Bị Đầu Độc Trong Dữ Liệu')) return 'Poisoned Amount in Data';
    if (label.includes('Nguồn Dữ Liệu Hợp Lệ')) return 'Legitimate Data Source';
    if (label.includes('Trích Xuất Trường Recipient')) return 'Extracted Recipient Field';
    if (label.includes('Trích Xuất Trường Amount')) return 'Extracted Amount Field';
    if (label.includes('Trường Thanh Toán Hợp Lệ')) return 'Valid Payment Field';
    if (label.includes('Đề Xuất Payout Của Agent')) return 'Agent Payout Proposal';
    if (label.includes('Đề Xuất Hợp Lệ Của Agent')) return 'Valid Agent Proposal';
    if (label.includes('Validator Off-Chain Chặn Giao Dịch')) return 'Off-Chain Validator Blocks Transaction';
    if (label.includes('Validator Off-Chain Phê Duyệt')) return 'Off-Chain Validator Approves';
    if (label.includes('Hợp Đồng Thông Minh')) return 'Smart Contract on Avalanche Fuji';
    return label;
  };

  const translateSummary = (s: string) => {
    if (lang === 'vi') return s;
    return s
      .replace('Dữ liệu bẩn từ', 'Tainted data from')
      .replace('bị chặn bởi', 'blocked by')
      .replace('và được bảo đảm revert on-chain bởi', 'and guaranteed to revert on-chain via')
      .replace('Lớp on-chain: Chưa kiểm tra trực tiếp cho lượt này.', 'On-chain layer: Not tested directly for this run.')
      .replace('Dữ liệu hợp lệ từ [OWNER_MISSION] được phê duyệt an toàn.', 'Legitimate data from [OWNER_MISSION] safely authorized.');
  };

  const translateDetail = (d: string) => {
    if (lang === 'vi') return d;
    return d
      .replace('Taint registry phát hiện địa chỉ', 'Taint registry detected address')
      .replace('xuất hiện trong nội dung không được xác thực từ bên ngoài.', 'appearing in untrusted external content.')
      .replace("Trường 'recipient' chứa địa chỉ kẻ tấn công:", "Field 'recipient' contains attacker address:")
      .replace('Agent bị thuyết phục bởi nội dung độc hại và tạo đề xuất payout', 'Agent deceived by untrusted input, proposing payout of')
      .replace('tới', 'to')
      .replace('Kích hoạt quy tắc bảo vệ:', 'Validator policy check:')
      .replace('Lý do:', 'Reason:')
      .replace('Mô phỏng server bị chiếm: Gọi thẳng proposeWithProof lên Fuji -> Kết quả mô phỏng:', 'Simulated compromised server: direct proposeWithProof call to Fuji -> Result:');
  };

  return (
    <div className="bg-paper border border-rule rounded-data p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-rule pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-2">
            {tr('Đường Đi Dữ Liệu Bẩn (Provenance Trace)', 'Tainted Data Path (Provenance Trace)')}
          </span>
        </div>
        <span
          className={`text-[13px] font-bold px-2.5 py-0.5 rounded-tag border ${
            trace.isBlocked
              ? 'bg-blocked-bg text-blocked border-blocked-rule'
              : 'bg-paid-bg text-paid border-paid-rule'
          }`}
        >
          {trace.isBlocked ? tr('ĐÃ CHẶN NGUỒN GỐC BẨN', 'TAINTED SOURCE BLOCKED') : tr('NGUỒN GỐC AN TOÀN', 'SAFE SOURCE')}
        </span>
      </div>

      <p className="text-xs text-ink-2 font-mono bg-card p-2.5 rounded-data border border-rule">
        {translateSummary(trace.summary)}
      </p>

      {/* Visual Step-by-Step Flow */}
      <div className="relative pl-6 space-y-4 border-l-2 border-rule ml-3">
        {trace.steps.map((st) => {
          let badgeColor = 'bg-mist text-ink-2 border-rule';
          let dotColor = 'bg-slate-400';

          if (st.status === 'TAINTED') {
            badgeColor = 'bg-warn-bg text-warn border-warn-rule';
            dotColor = 'bg-amber';
          } else if (st.status === 'BLOCKED') {
            badgeColor = 'bg-blocked-bg text-blocked border-blocked-rule';
            dotColor = 'bg-brand';
          } else if (st.status === 'REVERTED') {
            badgeColor = 'bg-paid-bg text-paid border-paid-rule';
            dotColor = 'bg-paid';
          } else if (st.status === 'SAFE') {
            badgeColor = 'bg-paid-bg text-paid border-paid-rule';
            dotColor = 'bg-paid';
          }

          return (
            <div key={st.step} className="relative group">
              {/* Dot on the timeline */}
              <div
                className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-rule ${dotColor} transition-transform group-hover:scale-125`}
              />

              <div className="bg-card border border-rule rounded-data p-3 space-y-1 hover:border-rule transition">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">
                    {tr('Bước', 'Step')} {st.step}: {translateLabel(st.label)}
                  </span>
                  <span className={`text-[13px] font-mono px-2 py-0.5 rounded-tag border ${badgeColor}`}>
                    {st.status}
                  </span>
                </div>
                <div className="text-[13px] font-mono text-ink-2">{st.source}</div>
                <div className="text-xs text-ink-2">{translateDetail(st.detail)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
