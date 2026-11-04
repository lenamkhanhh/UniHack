# 08 — Build plan và release gates

Planning snapshot 4/11/2026. Deadline an toàn 21/11 23:59 VN, feature freeze 17/11,
submit mục tiêu 20/11. Logistics đối chiếu [competition context](../context/competition-context.md);
không dựa vào deadline muộn hơn để mở rộng scope.

## 1. Lịch với output

| Ngày | Stage / output |
|---|---|
| 5–6/11 | S0: token/ABI/facilitator/SDK/finality spike; tx+result thật, manifest |
| 7–9/11 | S1: Postgres/auth, summary x402 + recovery, search, TalkMeter, own submission pack |
| 10–12/11 | S2: guard mission/idempotency/queue tests; deploy+verify; cutover maintenance |
| 13–14/11 | S2 integration: agent validator, event mirror, attack/control, P/V recovery checks |
| 15–16/11 | S3: owner feedback, proof export/verifier, UI/demo |
| 17/11 | Freeze; choose last passing stage; record video |
| 18–19/11 | Slides/README/evidence/link access checks |
| 20/11 | Submit và lưu xác nhận |
| 21/11 | Dự phòng link/bug, không thêm feature |

Lịch là mục tiêu, không chứng minh đội đủ bandwidth. Nếu S1 chậm, cắt optional trước;
giữ một tool complete qua auth/reservation/recovery thay vì ba tool chưa thanh toán đúng.

## 2. Chia việc và interfaces

A owns contracts + C-tests + deploy verification. B owns web/payments/DB/auth + P/V.
C nếu có: proof/export/ERC-8004/demo. Interface changes phải cùng update owning spec/consumers;
không đổi seed/test balances/caps âm thầm. Branch riêng, merge chỉ khi relevant checks pass.
Hai người vẫn làm được bằng cách freeze interfaces trước và giữ scope.

## 3. Thứ tự implement

1. Đọc 00 + 11 rồi owning spec theo nhiệm vụ. context/build-sources chỉ là reference, không override.
2. S0 một paid call thật trước UI lớn. Pin versions/ABI/finality, ghi blockers thật.
3. S1 provision DB, migration constraints → owner challenge/spend+read auth → quote/reserve/sign →
   held result/settlement verifier/reconcile → summary → search → TalkMeter → basic audit/export.
4. Chạy P/V và E1–E2, L1–L2; hoàn thành S1 README/video/slides, tạo annotated release tag với commit SHA.
5. S2 contract 01 và C tests trước deploy. App treasury request ID, owner MetaMask queue,
   chain mirror; cutover theo 05, không reset budget/tokens âm thầm.
6. S3 O completion/feedback, immutable registration URI, offline proof verifier,
   demo deliverable và video 2:30/slides 12 theo 07.
7. S4 optional theo 09 chỉ khi còn thời gian trước freeze. Không bắt buộc thêm replay, rolling cap hay multisig.

## 4. Definition of Done

- S0: L1 minimal + manifest; registry thiếu không chặn S1 payment. Facilitator không settle được
  là blocker của cả Rails, không có "fallback Rails" nếu chính Rails chưa chạy.
- S1: P/V áp dụng S1 và E1–E2 thực sự pass, L1/L2 có receipts/results, abandoned reservation cleanup,
  expiry read recovery và own submission pack hoàn tất. Đóng băng release S1.
- S2: C, treasury V/E và L3; same-request idempotency, queue/MetaMask, event backfill, positive control.
- S3: E4–E9/L4, proof+checkpoint, đúng deliverable/claims, link mở được.
- S4: Relevant new tests + không phá gates cũ. Không đòi rerun toàn bộ khi không có thay đổi liên quan.

Không tick gate chỉ vì spec liệt kê test. Record execution commands + actual results + limitations.
Trước push: git diff --check và relevant checks; không chèn generated secrets/DB dumps.

## 5. Review checklist cuối

- Auto payout nằm trong propose; owner execute chỉ cho Approved.
- Mission/auth/version và scope đúng cả S1/S2/read recovery.
- Một operation một auth, receipt đúng nonce, concurrent counters terminal một lần.
- Abandoned unsigned reservation không lock budget mãi; signed exposure không release sớm.
- DB constraints đúng như claims, no primitive index pretending unique.
- LLM vs key compromise đúng phạm vi; no auto-refill; UTC-day wording.
- Audit export không secrets; raw registry count không gọi success rate.
- Mọi claim live/implemented có test/receipt thật; optional chưa xây không xuất hiện như core demo.

Nếu một blocker kéo >4h: xác định hỏng library/version/config hay scope, ghi nguyên nhân và fix nhỏ;
không bỏ auth/accounting để demo chạy. Freeze mà S2 fail → nộp passing S1 tag,
đổi README/slides theo 07, không nộp S2 dở dang.
