# 00 — Guarded Agent Economy: sản phẩm, phạm vi và hằng số

## 1. Sản phẩm và use case

Một nhóm nghiên cứu/CLB giao agent một nhiệm vụ có ngân sách; agent mua công cụ để hoàn thành,
và người giao đối chiếu được quyền chi, payment và kết quả.

Mission demo: "Tìm một nguồn về chủ đề X và tạo bản tóm tắt có nguồn".
Search trả nguồn, summary tạo deliverable; mission owner nhận kết quả và chấm quality.
Treasury payout là luồng riêng để chi trả người cộng tác của nhóm; không thu thêm treasury payout
cho cùng một tool đã được thanh toán qua x402. TalkMeter là ví dụ metering thứ hai, simulated session.
Đóng góp sản phẩm: ngân sách theo việc + recovery có accounting + receipt nối được kết quả.
Không claim phát minh x402/guard/ERC-8004 hoặc dự báo điểm thắng.

## 2. Hai đường tiền và authority

| | Treasury (S2) | Tool purchase (S1+) |
|---|---|---|
| Tiền | GuardedTreasury | Ví agent A riêng, chỉ test USDC |
| Hành động | Agent gọi propose; contract auto-transfer nếu policy pass | Server reserve → ký EIP-3009 → facilitator settle |
| Giới hạn | Recipient allowlist, UTC daily, per-tx, mission treasury | Catalog/per-call, mission tool, session cap, reservations |
| Vượt cap | Queued; owner ký approve rồi execute | BLOCK, không human queue |
| Thực thi | Contract checks độc lập backend | Signer/pre-flight/DB; không bảo vệ nếu private key A lộ |
| Pause | Guard chặn propose/execute | Chặn chữ ký mới qua API; không thu hồi chữ ký đã phát hành |

Hai budget riêng. Treasury cap là giới hạn auto-execution có owner override rõ ràng;
tool cap enforce off-chain khi signer/backend còn an toàn. Không gọi một shared cap on-chain cho cả hai.
Guard chuyển ERC-20, không "ký" giao dịch token; owner ký tx qua MetaMask, backend không giữ key owner.
Auto payout diễn ra trong propose(), không gọi owner-only execute().

## 3. Stages và evidence

| Stage | Deliverable | Gate |
|---|---|---|
| S0 | Một x402 purchase Fuji thật, protocol/facilitator/token/finality manifest | Paid tx + result/receipt, không UI mock; guard không chặn S1 |
| S1 | Mission off-chain, auth/read recovery, payments, search/summary/TalkMeter, basic audit | P/V/E tests áp dụng S1 + live payment, own submission pack |
| S2 | Mission/treasury on-chain, queue, pause, idempotent propose, event mirror | C/V/E và live guard; owner actions MetaMask |
| S3 | ERC-8004 quality feedback, proof export/verifier, demo/slides | Identity/feedback live, offline verifier, accessible submission links |
| S4 | Optional simulation/replay/trust tiers | Chỉ sau S1–S3, trước freeze; không cần để nộp |

Freeze feature 17/11/2026; mục tiêu submit 20/11, planning deadline 21/11 23:59 VN.
Đây là lịch kế hoạch từ research snapshot; logistics chính thức còn khác giữa Team1/Builder Hub, xem context.
Nếu tới freeze S2 chưa đạt gate, nộp release S1 đã hoàn chỉnh, đổi claims/demo theo S1.
Giữ checkpoint/tag S1 trước khi build S2, không dùng feature flag để giấu S1 chưa hoàn thành.

## 4. Kiến trúc

User/mission owner → authenticated app → JSON proposer → deterministic validator.
Treasury → GuardedTreasury.propose(operationId, ...) → auto/queue/block.
Tools → quote → atomic reservation → immutable authorization → durable result → settlement verifier.
Evidence → sanitized event/audit + private result + owner-approved public proof.
S1 dùng DB owner/pause; S2 chuyển chain authority bằng maintenance cutover (05).
On-chain authoritative cho tiền/treasury state; DB authoritative cho tool reservations và private result.
RPC/DB failure chặn spend mới, vẫn giữ pending exposure; không hiển thị ledger rỗng như chưa chi.

## 5. Normative ownership và cách đọc

| File | Sở hữu quyết định |
|---|---|
| 00 | Scope, constants, stage names |
| 01 | Contract interface, hard/soft policy, treasury state |
| 02 | x402 states, authorization, settlement/recovery, TalkMeter |
| 03 | ERC-8004 roles, deployed ABI và feedback eligibility |
| 04 | Proposer, validation, canonical audit/proof encoding |
| 05 | DB constraints, auth, API, cutover |
| 06 | Acceptance IDs và required checks theo stage |
| 07–09 | Demo/submission, build order, optional work |
| 10 | Lịch sử review, không phải specification override |
| 11 | Handoff tóm tắt, không override owning spec |

Không có luật "file số lớn hơn thắng". Khi phát hiện mismatch, sửa owning file và consumers trong cùng commit.
Không thêm stage hoặc tính năng để lấp một lỗi state machine.

## 6. Hằng số dùng chung

| Constant | Giá trị |
|---|---|
| Chain | Avalanche Fuji, chainId 43113 |
| RPC | https://api.avax-test.network/ext/bc/C/rpc |
| Explorer | https://testnet.snowtrace.io |
| USDC | 0x5425890298aed601595a70AB815c96711a31Bc65, 6 decimals |
| Registry candidates | Identity 0x8004A818BFB912233c491871b3d84c89A494BD9e; Reputation 0x8004B663056A597Dffe9eCcC1965A193B7388713 |
| Per-tx / UTC daily treasury cap | 5000000 / 20000000 atomic USDC |
| Mission treasury / tool cap | 10000000 / 5000000 atomic USDC |
| Mission duration / queue TTL | 24h / 48h |
| Search / summary / TalkMeter | 100000 / 500000 / 50000 atomic USDC |
| TalkMeter session cap | 2000000 atomic USDC |
| Quote / unsigned reservation TTL | 60s / 60s (independent from chain authorization validity) |
| Authorization TTL | <= 60s; timestamps derived with chain/SDK clock-skew handling |
| Auth challenge / owner read token TTL | 600s / 900s |
| Velocity | 10 new calls/minute/agent; retries/recovery reads are not new purchases |

Addresses là candidates phải verify lúc spike; chưa có deployment/tx evidence ở lượt này.
Registry/token ABI pin theo implementation thực tế, không suy từ draft.
Không đổi giá/cap/chain âm thầm; thay một hằng số phải cập nhật manifest/tests/demo có liên quan.

## 7. Manifest lúc implement

Commit deployment manifest với chain/token/address/ABI hash, SDK lockfile versions, protocol version/header,
facilitator supported snapshot, registry implementation/code hash, finality rule, guard deployment,
policy snapshot/block, wallet role public addresses và S1/S2 stage.
Không có secret, token hay raw authorization signature trong manifest.
Finality phải được xác minh trên RPC Fuji thực tế trước khi credit payment; receipt pending không phải final.

## 8. Giới hạn và rubric

LLM compromise có thể gây chi vô ích trong policy. Agent key compromise có thể mất toàn bộ số dư ví tool
và mọi refill tiếp theo; không auto-refill. Treasury vẫn bị guard giới hạn theo mission/UTC day;
qua nửa đêm UTC có budget ngày mới. Owner có quyền override/emergency withdraw nên không được bảo vệ khỏi chính owner.
Pause không recall chữ ký x402 đã phát hành. Audit hash chứng minh consistency với checkpoint,
không chứng minh chất lượng câu trả lời hay lịch sử tuyệt đối. Reputation từ demo clients không Sybil-proof.
x402 là multi-chain; bài này chứng minh tích hợp hoạt động trên Avalanche Fuji.

Rubric: Technical 25 → code/tests/recovery; Avalanche 25 → Fuji receipts/source verification;
Creativity 15 → mission-linked receipts; Impact 15 → deliverable cụ thể cho nhóm;
Presentation 10 → video có bằng chứng; UI/UX 10 → budget/queue/recovery dễ hiểu.
Đây là evidence mapping, không phải dự báo điểm. Mock và scripted/live mode luôn ghi đúng.
