# 11 — Handoff triển khai

Đọc 00 trước; 01/02/03/04/05 là owning specs, 06 là acceptance. 10 chỉ là lịch sử.
Không có quy tắc "file số lớn hơn thắng". Repo ở lượt hardening này vẫn chỉ là spec, chưa có implementation/tests pass.

## 1. Sản phẩm và giới hạn

Nhóm nghiên cứu giao mission có budget, agent dùng search + summary tạo deliverable có nguồn.
Hai đường tiền: treasury trong guard S2; tool payments qua signer + reservation từ S1.
TalkMeter là simulated metering, không full meeting app. Giữ S1 submittable, không đợi guard mới build payment.

## 2. Invariants cần implement

1. Mọi spend có mission đã được O cấp, đúng agent A, còn hạn và credential đúng deployment/stage/authVersion.
2. S1 owner/pause từ config+DB; S2 từ guard. Cutover maintenance + version revocation, không reset outstanding spend.
3. Owner ký MetaMask, backend chỉ key A. O != A; ERC-8004 NFT owner=A, feedback client=O.
4. BLOCK hard trước soft caps. Treasury auto trong propose; QUEUE on-chain, approve/execute owner hai tx.
5. Mission hết hạn/closed và recipient bị gỡ không owner-override. Soft caps được approve cho proposal cụ thể.
6. Treasury requestId unique on-chain, duplicate HTTP/broadcast không tạo payout mới.
7. x402 quote chưa reserve/compute. Reserve atomic trước ký; unsigned lease expiry khác signed authorization expiry.
8. Một operation một immutable authorization; UNIQUE nonce binding chống credit lại cùng payment.
9. Persist signature/state trước transmission, held result trước settle, submission intent trước external call.
10. Finalize payment từ đúng token/nonce/Transfer/receipt + finality, không từ nonce bool hay amount đơn lẻ.
11. SETTLED/FAILED + counters + audit atomic/idempotent. UNKNOWN giữ reservation.
12. CREATED/unsigned RESERVED có deadline cleanup; đã SIGNED chỉ release sau reconcile an toàn.
13. operationId global unique, UNIQUE(sessionId,minuteIndex), input/terms/mission/payer binding.
14. Mission đóng/hết hạn/pause không làm mất quyền owner read/reconcile/result. Read token không có quyền sign/spend.
15. Tool budget off-chain không bảo vệ khi key A lộ; no auto-refill. Pause không recall chữ ký đã phát hành.
16. Audit append serialized, unique source events, verifier dùng export/checkpoint, public export redact private fields.
17. ERC-8004 feedback 1 lần/mission do O xác nhận deliverable và paid operation, không gọi là success rate.
18. Mock, scripted, live chain là badges khác nhau; chỉ receipt thật mới ghi live Fuji tx.

## 3. Thứ tự làm và gate

- S0: verify token/SDK/facilitator/version/finality, 402→paid→result thật. Ghi manifest, chưa có tx thì đừng build UI lớn.
- S1: provision Postgres; auth/read access; quote/reserve/signer/recovery; one summary tool; search; TalkMeter;
  audit cơ bản; P/V/E tests áp dụng S1; live payment + S1 video/slides. Tag release S1.
- S2: contract C tests (mission+idempotency+queue), deploy/verify Fuji; authenticated treasury route,
  cutover, MetaMask queue, event mirror, attack + positive control.
- S3: feedback đúng wallet roles; proof export/offline verifier; demo deliverable; 12-slide deck/video.
- S4 optional theo 09, dừng ở freeze 17/11/2026. Không cắt accounting/auth/recovery để kịp stretch.

Mỗi stage chỉ đạt khi checks 06 cho stage đó chạy thực sự; ghi commands/results và tx hashes.
Nếu S2 chưa đạt lúc freeze, nộp S1 release; bỏ guard/feedback claims chưa xây.

## 4. Tình huống bắt buộc trước live demo

402 bị bỏ dở; signer đua expiry worker; hai operation tranh budget; duplicate session tick;
authorization ký lại cho cùng operation; response timeout trước/sau submit; process crash sau settlement;
nonce cancel; payment giống payer/amount nhưng khác nonce; reused nonce; concurrent finalize;
mission hết hạn trước delayed settlement; read recovery sau expiry; cutover với outstanding payments;
treasury broadcast timeout và retry; event ingest trùng; DB/RPC unavailable.
Xem IDs và expected outcomes tại 06, không tick bằng suy luận.

## 5. Chưa xác minh

Deployed USDC/registry ABI + code hash, facilitator actual settlement, Fuji finality RPC,
SDK package versions, DB provisioning, migrations, app/contracts/verifier và mọi test runtime.
Không có số liệu benchmark hay deploy address được tạo trong lượt sửa spec.
