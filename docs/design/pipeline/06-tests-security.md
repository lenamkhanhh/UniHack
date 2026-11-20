# 06 — Acceptance matrix và threat model

**Tất cả dưới đây là requirements, chưa chạy và chưa pass.** Không dùng spec review làm test evidence.
Lệnh thực tế ghi khi app/contracts tồn tại, cùng tool versions/commit, setup, expected/actual và tx hashes.
C = Foundry, P/V/E = app integration (Vitest/Node + PostgreSQL test riêng), L = Fuji live.
Gates theo stage (không dùng contract-only test để chặn S1):

| Stage | Required IDs |
|---|---|
| S1 | P1–P25; V3, V4, V6–V9, V11, V12, V14, V15; E1, E2; L1, L2 |
| S2 | S1 regressions liên quan + C1–C22; V1, V2, V5, V10, V13; E3; L3 |
| S3 | S1/S2 regressions liên quan + E4–E9; L4 |

## 1. Contract C-series (S2)

| ID | Setup / action | Expected |
|---|---|---|
| C1 | Active mission, allowlisted recipient, amount=perTx cap | Auto Executed trong propose, đúng token/balance/spent/events |
| C2 | Vượt perTx | Queued, không transfer |
| C3 | Vượt UTC daily sau khoản chi trước | Queued; qua ngày UTC mới accounting ngày mới, không gọi rolling |
| C4 | Vượt mission cap | Queued, missionSpent không tăng |
| C5 | Mission zero/nonexistent/closed/expired/wrong agent | Revert, không tạo proposal |
| C6 | Recipient zero/not allowlisted | Revert kể cả amount đồng thời over cap |
| C7 | Lookalike khác full address | Revert; valid recipient control thành công |
| C8 | Queued → owner approve → execute | Hai tx riêng; đúng balances/status |
| C9 | Queued hoặc Approved → reject | No transfer, execute sau reject revert |
| C10 | Pause propose/approve/execute, rồi unpause | Hard checks chặn; unpause không auto-execute |
| C11 | A gọi owner functions | Revert, policy/balance không đổi |
| C12 | A gọi direct transfer/arbitrary approve path | Không có supported path; không rút treasury trực tiếp |
| C13 | Expiry của Queued/Approved và mission | approve/execute check trong hàm; expire cleanup đúng boundary |
| C14 | Approve/execute lặp | Revert, không accounting lần hai |
| C15 | Gỡ recipient sau queue/approve | Execute revert, status còn Approved; reject vẫn được |
| C16 | Owner override soft caps | Accounting đủ amount, overBy visible; next auto request queue |
| C17 | Nới/siết policy và mission expiry giữa hai tx | Không tự chạy, hard re-check hiện tại |
| C18 | Reentrant token mock vào propose/execute | NonReentrant + CEI; không double-spend |
| C19 | Duplicate operationId trong mission, kể cả auto payout | Một transfer/proposal duy nhất; duplicate revert; mapping đọc được |
| C20 | Insufficient token balance / transfer revert | Proposal/accounting/mapping rollback atomically |
| C21 | transferOwnership/renounceOwnership | MVP revert trực tiếp, không chỉ UI ẩn |
| C22 | App predicted queue khác chain vì state đổi; agent recipient/refill | Actual receipt authoritative; payout về agent bị hard block; no auto-refill |

Dùng fork/mock để unit test; live source verify không thay thế unit tests.
Record constructor/config; amount uint256 + UTF-8 reason byte limits test cả boundary.

## 2. Payment P-series (S1, dùng DB thật trong test)

| ID | Setup / action | Expected |
|---|---|---|
| P1 | Unpaid request | Full v1 402 envelope/terms/operationId; chưa reserve/compute |
| P2 | Normal quote → reserve → sign → held result → settle | 200 only after verified receipt; đúng balance/result hash |
| P3 | Sai network/token/payTo/amount/signature/expired auth | Không settle/serve; không gán payment khác |
| P4 | Same operation/scope retry | Same quote/state/result, không upstream/payment lần hai |
| P5 | Input/tool/terms/payer/mission mismatch | 403/409, record bất biến, không overwrite nonce |
| P6 | Concurrent operation IDs tranh budget cuối | Một reserve thắng, available check có price; không vượt cap |
| P7 | Concurrent same operationId hai mission | Global PK quyết định một thắng, bên kia conflict |
| P8 | Duplicate/concurrent TalkMeter index | Unique constraint, một operation/payment; pending retry trả pending |
| P9 | Tick 0–59s, 60s, 120s; stop/cap | Không charge trước phút hoàn thành; rate/cap đúng; stop không xóa outstanding |
| P10 | CREATED quote và unsigned RESERVED bị bỏ dở | Expire cleanup không RPC; budget trả lại đúng một lần |
| P11 | Signer race unsigned expiry worker | CAS chỉ một thắng; không phát hành chữ ký nếu reservation đã release |
| P12 | Retry cố ký nonce thứ hai cho cùng operation | Reject; auth fields bất biến; nonce unique across operations |
| P13 | Upstream fail trước settlement | Không settle; signed exposure giữ tới expiry/cancel reconcile |
| P14 | Crash sau persist SIGNED, trước/sau external submit | Resume cùng auth; không tạo nonce mới; SUBMITTING unknown được bảo toàn |
| P15 | Facilitator timeout, validBefore chưa qua | UNKNOWN + reserved; không suy thất bại từ nonce=false |
| P16 | Wall-clock hết nhưng finalized chain chưa tới expiry | Giữ UNKNOWN/reserved |
| P17 | Finalized timestamp >= validBefore, nonce=false tại cùng block | FAILED và release một lần |
| P18 | Nonce=true vì cancel | Không SETTLED; finalized cancel → FAILED/release |
| P19 | Transfer cùng payer/amount nhưng sai nonce/token/chain | Không credit; payment phải bind đúng auth + receipt |
| P20 | Same nonce/receipt cố dùng cho hai operation | DB unique + verifier ngăn double credit, kể cả tx batch |
| P21 | Crash sau chain settlement trước DB finalize/response | Recover đúng heldResult bền vững, không gọi upstream mới |
| P22 | Hai GET reconcile/finalize đồng thời | State/counters/audit chỉ chuyển terminal một lần |
| P23 | Reverted tx trước expiry | Không release chỉ vì tx revert; auth vẫn có thể submit |
| P24 | Payment settle sau pause/mission expiry | Vẫn accounting; marker after-pause; owner read được result |
| P25 | DB/RPC/facilitator unavailable + no evidence | Fail closed cho spend mới, UNKNOWN giữ exposure; không fabricate receipt |

## 3. Auth/API V-series

| ID | Action | Expected |
|---|---|---|
| V1 | Over cap treasury + valid schema | Pass schema, QUEUE policy; malformed/unknown keys reject |
| V2 | Not allowlisted đồng thời over cap | BLOCK trước QUEUE |
| V3 | Arbitrary approve/max allowance/calldata | Strict schema/capability reject; không đường signer tùy ý |
| V4 | Missing/forged/wrong mission spend token | Không dùng key A, không compute |
| V5 | Owner API forged txHash/reverted receipt | Không ghi confirmed audit; backend không có owner key |
| V6 | S1 auth/pause khi guard absent | Không gọi guard, signed owner actions có nonce/action/domain binding |
| V7 | Challenge replay/expiry/action/payload/domain/version tamper | Reject; nonce consume atomic, challenge không bị overwrite |
| V8 | Read token gọi reserve/propose; expired spend token | Reject spend; owner có thể xin read token mới |
| V9 | Mission đóng/hết hạn với payment outstanding | Không spend mới; read/reconcile/result và counters vẫn đúng |
| V10 | Cutover S1→S2, outstanding ops, old tokens/challenges | Maintenance chặn sign; version revoke S1; historical payment vẫn recover |
| V11 | Cross-mission read/unknown operation | Không lộ tồn tại/state/result/signature; uniform scoped error |
| V12 | Seller redirect/prompt injection/URL lạ | Không credential forwarding, full seller/resource allowlist |
| V13 | Duplicate treasury HTTP request/broadcast timeout | Same on-chain operation mapping; một payout |
| V14 | New tool call với remaining < price nhưng > 0 | BLOCK, không reserve/sign |
| V15 | Public demo request arbitrary amount/recipient/reset | Không ký tùy ý/không wipe history; owner-only bounded scripts |

## 4. Evidence và ERC-8004 E-series

| ID | Stage | Expected |
|---|---|---|
| E1 | S1 | Audit concurrent append serialized; unique source keys; duplicate terminal/event ingest không duplicate |
| E2 | S1 | Export canonical verifier pass với original; tamper/reorder/truncate lệch checkpoint fail |
| E3 | S2 | Verified events → mirror; duplicate/backfill/reverted tx không bịa state |
| E4 | S3 | A register/read owner/agentWallet/URI đúng deployed ABI |
| E5 | S3 | O completion + paid verified operation → một feedback/mission; self-feedback A revert |
| E6 | S3 | No completion/forged payment/wrong owner/duplicate feedback → app reject hoặc reconcile existing, không publish score giả |
| E7 | S3 | getSummary 4 args + trusted list, raw vs app-verified score → đọc đúng scale/count, không gọi count là số call |
| E8 | S3 | Public proof không token/key/signature/private heldResult; owner export recompute result hash |
| E9 | S3 | Offline verifier từ export + checkpoint không cần DB credentials; online chain validation là bước riêng |

## 5. L-series và attack evidence

- L1 (S0/S1): Fuji payment thật, receipt/token/nonce binding, result, seller balance, facilitator/version/finality manifest.
- L2 (S1): two completed TalkMeter minutes → 0.10 USDC, two unique receipts; stop không thêm charge.
- L3 (S2): guard deploy+source verify, auto payout, queue/approve/execute, pause/unpause, live mission expiry/read.
- L4 (S3): registry deployed ABI reads, register và O feedback, proof export đối chiếu receipt thật.
Không gửi tiền/testnet transaction ở lượt sửa tài liệu. Khi implementation mới chạy live smoke có key test riêng.

Attack replay: cùng intent/output proposal cho naive và guarded, cùng số tiền/recipient và conditions.
Để cô lập control, dùng proposal cố định độc hại; nếu dùng live LLM ghi model/prompt/output, không ép baseline thua.
Ít nhất unauthorized/lookalike recipient, forbidden approval intent, injected tool output.
Ghi before/after balances cả hai bên, route/rule, chain tx hoặc pre-sign BLOCK, rồi positive valid request thành công.
So sánh full system chứng minh full system; muốn claim riêng guard thì gọi contract trực tiếp vượt backend
trong test có kiểm soát. Không dùng validator BLOCK làm bằng chứng contract đã được tấn công.

## 6. Threat model và submission checks

| Threat | Guarantee / limit |
|---|---|
| LLM injection, signer intact | Policy/caps/allowlist vẫn enforce, nhưng chi hợp lệ có thể vô ích |
| Key A compromised | Tool loss <= balance hiện có + mọi refill tới khi key được thay/loại; off-chain caps/pause vô hiệu |
| Treasury với compromised A | Chỉ active missions/allowlist, auto caps UTC day/mission; nhiều mission/ngày phải tính aggregate |
| Owner O compromised | Ngoài guarantee; owner set policy/override/withdraw |
| Merchant/facilitator failure | Terms bất biến không bảo đảm quality/availability; UNKNOWN có thể cần manual evidence |
| Ledger operator rewrites | Checkpoint phát hiện khác bản đã export; không đảm bảo lịch sử trước checkpoint |
| Reputation farming | Self-feedback rule không chống Sybil; no automatic privilege escalation |

MVP không auto-refill và không cho guard payout tới mission.agent; owner tự cấp test funds bằng giao dịch riêng có chủ ý.
Feature checklist: secrets absent; public links accessible; C/P/V/E required stage checks executed; L receipts real;
guard source verified khi claim S2; protocol modes labelled; no fake scores; evidence redacted; read recovery chạy sau expiry.
Old T1–T15 và V13–V21 trong lịch sử 10 chỉ provenance. IDs hiện tại ở file này là authoritative; đừng dùng số cũ để tick pass.
