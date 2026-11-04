# Spike checklist — Fuji payment trước, không chặn S1 bằng guard

Research/build snapshot 4 November 2026. Owning specs: pipeline/00–05; acceptance IDs ở pipeline/06.
Checklist này là execution plan, mọi ô chưa tick. Không coi historical T/V IDs là test evidence.

## Day 1: x402 feasibility

- [ ] Ví test O/A/S riêng, A != O và A != S; private keys không commit.
- [ ] Fuji chain 43113, official USDC address/6 decimals và deployed ABI được verify.
- [ ] Pin SDK protocol version/facilitator supported response; v1 exact mục tiêu.
- [ ] Full unpaid 402 envelope → one signed exact authorization → held result → confirmed settlement → 200.
- [ ] Receipt verifier nối đúng token, AuthorizationUsed nonce và Transfer; record tx/result thật.
- [ ] Pin Fuji RPC finality rule đã xác minh; không credit chỉ từ nonce bool hay pending tx.
- [ ] Ghi deployment manifest: SDK/ABI hashes/addresses/facilitator/version/finality và evidence.
- [ ] Registry identity read/register thử nếu sẵn; chưa có registry không block payment S1.

Nếu x402 chưa settle được thì Rails chưa đạt feasibility; đổi facilitator/version nhất quán trong ngày,
không tuyên bố fallback Rails đã hoạt động khi payment chưa chạy.

## Day 2: nhỏ nhất để biết build có khả thi

- [ ] Postgres reachable; global operationId và nonce/tick unique constraints có kế hoạch migration cụ thể.
- [ ] S1 owner/auth/pause/read recovery không gọi guard.
- [ ] Bỏ dở unsigned reservation có cleanup; signed UNKNOWN không release sớm.
- [ ] One same-operation retry + one concurrency budget case + restart result path thiết kế/runnable.
- [ ] Chọn summary làm paid vertical slice đầu; search/TalkMeter ghép sau.
- [ ] Nếu có bandwidth, guard prototype với mission/queue/idempotency có thể thử; không gate S1 trên guard.

Sau spike, hoàn thiện P/V/E required S1 + L1/L2 ở 06 và own submission pack ở 07.
Chỉ khi passing S1 mới chuyển S2 guard; S2 thêm C-series, MetaMask queue/cutover/live receipts.
S3 mới hoàn thiện feedback/proof. Không làm stretch trước core.
Freeze 17/11, mục tiêu submit 20/11, planning deadline 21/11 23:59 VN; logistics recheck organizer sources.

## Deliverables phải điền khi thực sự có evidence

- Chain/token/deployed ABI hashes.
- Facilitator/protocol/SDK versions/finality rule.
- Paid operation + nonce-bound tx + result hash.
- Stage và actual commands/results.
- Nếu S2: guard address/source verify + mission/queue/attack evidence.
- Nếu S3: agentId/feedback/checkpoint/verifier export.
Không có evidence thì ghi "pending", không bịa tx, không tick test bằng suy luận.
