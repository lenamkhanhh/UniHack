# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG S2/WOW A1..A9)

**Thời điểm:** 2026-11-10 13:20 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Trước Fix:** `5004698`  
**HEAD Hiện Tại:** `7f70d03`  

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **PASS** *(Reviewer đã accept tại 15d8ee5)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `propose`; cả `approve` và `execute` đều kiểm tra `currentRoot == snapshotRoot` (`ProposalPayeePolicyChanged`). Handler ghi nhận `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. |
| **A2** | **P1** | **PASS** *(Đã xử lý A2-R1..R6)* | `d37d365` | `apps/web/lib/webauthn-p256.ts`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/app/missions/new/page.tsx`<br>`apps/web/tests/webauthn-p256.test.ts`<br>`apps/web/tests/passkey-relay.test.ts`<br>`apps/web/tests/e2e/passkey.spec.ts` | Bỏ fallback demo config; DER parser kiểm tra tổng độ dài, biên nguyên, $0 < r, s < N$, normalize low-s; P-256 verification độc lập trên $authenticatorData \parallel \text{sha256}(clientDataJSON)$; RP ID / Origin khớp chính xác context; virtual authenticator e2e hai mission liên tiếp pass. Đánh dấu trung thực `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware live ghi `NOT_RUN`. 24/24 unit tests pass, 8/8 relay tests pass. |
| **A3** | **P1** | **PASS** *(Đã xử lý A3-R1..R2)* | `f0fd3b4` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Passkey governance kiểm tra chữ ký P-256 thực sự (bác bỏ sai private key, sai calldata, mutated signature, shared-nonce replay). Bổ sung hành động `sweepMissionWalletWithAuthorization` và test thu hồi USDC về địa chỉ owner ký (`test_A3_recoveryFunds_reach_signed_recipient_and_relayer_cannot_redirect`). 32/32 governance tests pass, 16/16 authority tests pass. |
| **A4** | **P1** | **PASS** | `62df640` | `apps/web/lib/validation-bundle.ts`<br>`apps/web/lib/validator-job.ts`<br>`apps/web/app/api/missions/[slug]/close/route.ts`<br>`apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261109230000_m7_validator_lifecycle/migration.sql`<br>`apps/web/tests/m7-validator-automation.test.ts` | Bỏ khoảng block cứng 60689760..60689770, scan theo deployment block và snapshot thực tế; persist trạng thái job/requestHash/block range vào DB; sinh unsigned validationRequest cho owner ký khi thiếu signer; tách rõ LOCAL_EVALUATED, REQUEST_PENDING, RESPONSE_PENDING, RESPONSE_CONFIRMED. 8/8 tests pass. |
| **A5** | **P1** | **PASS** | `0680f4a` | `apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110020000_add_bounty_attempt/migration.sql`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Migration `20261110020000_add_bounty_attempt` deploy sạch trên database rỗng `unihack_review_fix`; root build build `@missionpay/guard` trước `web`; DEPLOY_CHECKLIST liệt kê biến theo getters bằng placeholder. Root build exit code 0. |
| **A6** | **P2** | **PASS** | `e51e452` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Timeout ngắt tiến trình con thực sự qua `multiprocessing.Process` (spawn context) + `p.terminate()`, không còn side effect chạy ngầm; cache key ràng buộc đầy đủ prompt, attack payload, system message, defense revision, backend/model digest. Sleep probe thoát trong ~0.15s (trước đây 0.39s). 8/8 python tests pass. |
| **A7** | **P2** | **PASS** | `dde044e`<br>`fea5f20` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts`<br>`apps/web/lib/validator.ts` | Check proposal mission_id khớp canonical mission ID/slug (`isMissionIdMatch`); tính lại Merkle root từ `payees` đối chiếu `payeeRoot` (fail-closed khi mismatch); tôn trọng hard BLOCK (`RECIPIENT_NOT_ALLOWLISTED`, `RECIPIENT_UNTRUSTED_PROVENANCE`) trước soft QUEUE. 19/19 tests pass trong `@missionpay/guard`. |
| **A8** | **P2** | **PASS** | `13e4255`<br>`fea5f20` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/app/bounty/page.tsx`<br>`apps/web/tests/bounty.test.ts` | Ranh giới server phân loại source: public không thể spoof `source=test` (yêu cầu `x-bounty-auth-key` khớp `BOUNTY_INTERNAL_SECRET`, không key mặc định); rate limit bền vững qua Prisma DB window (5 req/phút/IP, 200/ngày global); tách bạch trung thực confirmed contract blocks khỏi RPC errors, queue và no payout với disclaimer mô phỏng. 13/13 bounty tests pass. |
| **A9** | **P2** | **PASS** | *(Current)* | `README.md`<br>`SECURITY.md`<br>`FORMAL.md`<br>`DEPLOY_CHECKLIST.md`<br>`JUDGE_QA.md`<br>`eval/agentdojo/AGENTDOJO.md`<br>`REPORT_REVIEW_AND_FIX_COMPLETION.md` | Sửa tên invariant không tồn tại (`invariant_disbursementRequiresMerkleProof` -> `invariant_payeeAlwaysInRoot`); cập nhật bảng 158/169 thành 169/169 trong `AGENTDOJO.md`; xóa claim 10/10 live unverified; phân biệt rõ local cryptographic boundary / virtual authenticator với live hardware biometric (ghi `NOT_RUN`); ghi rõ contract đã vá trong `contracts/` CHƯA được deploy lên Fuji; làm rõ Halmos là bounded symbolic testing ($\le 2$ depth), không phải full formal proof; cập nhật số test kiểm chứng chính xác. |

---

## 2. KẾT QUẢ KIỂM CHỨNG TOÀN DIỆN (TEST RUN EVIDENCE)

### 2.1 Foundry Smart Contract Test Suite
- **Lệnh chạy:** `forge test --root contracts --summary`
- **Kết quả:** **111 Passed / 0 Failed / 0 Skipped** (Toàn bộ 6 test suites)
  - `GuardedTreasuryTest`: **43 passed** (bao gồm 5 tests hồi quy A1 `test_A1_*`)
  - `PasskeyGovernanceTest`: **32 passed** (bao gồm P-256 genuine verification, wrong-key negatives, mutated signature, sweep token recovery `test_A3_*`)
  - `PasskeyMissionAuthorityTest`: **16 passed** (bao gồm 8 security vectors: phishing origin, wrong RP ID, missing UV/UP, high-S, cross-origin)
  - `MissionCrossChainICMTest`: **12 passed** (mock gateway-hub relay, nonce derivation)
  - `ValidationRegistryTest`: **7 passed** (ERC-8004 validation lifecycle, score bounds, caller gating)
  - `GuardedTreasuryInvariantTest`: **1 passed** (6 stateful invariants fuzzed qua **512 runs / 32,768 calls / 0 reverts**):
    - `invariant_payeeAlwaysInRoot` [PASS]
    - `invariant_missionSpendWithinCap` [PASS]
    - `invariant_dailySpendWithinCap` [PASS]
    - `invariant_nonOwnerCannotChangePolicy` [PASS]
    - `invariant_pausedNoOutflow` [PASS]
    - `invariant_balanceAccounting` [PASS]

### 2.2 Guard SDK Test Suite (`@missionpay/guard`)
- **Lệnh chạy:** `npm.cmd --workspace=@missionpay/guard test`
- **Kết quả:** **19 Passed / 0 Failed / 0 Skipped** across 2 files
  - `tests/guard.test.ts`: **16 passed** (canonical mission ID scoping, fail-closed Merkle recalculation, hard block before queue)
  - `tests/parity.test.ts`: **3 passed** (parity test giữa SDK và web validator)

### 2.3 Web Application Test Suite (`apps/web`)
- **Lệnh chạy:** `npm.cmd --workspace=apps/web test`
- **Kết quả:** **277 Passed / 0 Failed / 1 Skipped** across 32 test files
  - *Ghi chú test skipped:* 1 test trong `m7-validator-automation.test.ts` (M7-06 Anvil Fork test skipped vì yêu cầu live fork daemon có private key).

### 2.4 AgentDojo Python Benchmark Suite
- **Lệnh chạy:** `UniHack/eval/agentdojo/.venv/Scripts/python.exe UniHack/eval/agentdojo/test_provguard_pairs.py`
- **Kết quả:** **8 Passed / 0 Failed** in 0.926s
  - Kiểm chứng: 48 cặp ProvGuard cố định duy nhất, injection task IDs $\in \{0, 1, 2\}$, 16 user tasks xuất hiện đúng 3 lần, hard timeout process kill, và cache provenance fingerprinting.

### 2.5 Root Production Build
- **Lệnh chạy:** `npm.cmd run build`
- **Kết quả:** **Code 0**. Build hoàn tất sạch: `@missionpay/guard` build tsc -> `apps/web` next build (33/33 static pages generated).

---

## 3. CƠ SỞ DỮ LIỆU & BẰNG CHỨNG MIGRATION SẠCH (A5)

- **Cơ sở dữ liệu kiểm chứng:** PostgreSQL 16 chạy trên `127.0.0.1:55432`, database chuyên dụng: `unihack_review_fix`.
- **Quy trình kiểm chứng:**
  1. Tạo database sạch `unihack_review_fix`.
  2. Chạy lệnh: `npx prisma migrate deploy`.
  3. Kết quả: Toàn bộ 6 migrations được apply thành công từ đầu (không sử dụng `db push`):
     - `20261106093855_init`
     - `20261107050000_p1_treasury_caps`
     - `20261107120000_s2_hashchain_checkpoint`
     - `20261108000000_add_talkmeter_and_agent_id`
     - `20261109230000_m7_validator_lifecycle`
     - `20261110020000_add_bounty_attempt`
  4. Đã kiểm chứng các bảng `BountyAttempt`, `ValidatorJob`, `AuditEntry`, `Mission`, `ToolOperation` được tạo đầy đủ với các ràng buộc duy nhất.

---

## 4. BẰNG CHỨNG ĐO ĐẠC PROBE TRƯỚC / SAU

1. **Probe A1 (Root Policy Change on Queue):**
   - *Trước fix:* Propose with proof tới Payee A (6 USDC, status: QUEUED) -> Owner approve -> Đổi root chỉ còn Payee B -> Execute vẫn thành công, A nhận tiền dù không còn trong root.
   - *Sau fix:* Snapshot root được lưu tại proposal. Khi đổi root sang B, `execute(proposalId)` revert với mã lỗi `ProposalPayeePolicyChanged(bytes32, bytes32)`. Đổi root từ 0 sang nonzero cũng revert tương tự.
2. **Probe A6 (Subprocess Timeout Hard Termination):**
   - *Trước fix:* Context manager `ThreadPoolExecutor.shutdown(wait=True)` làm hàm chờ hết sleep: task sleep 0.35s, timeout 0.02s mất **0.39s** để thoát.
   - *Sau fix:* `run_task_with_timeout` sử dụng `multiprocessing.Process` (spawn context). Khi timeout 0.03s, tiến trình con bị `p.terminate()` và `p.kill()` ngay lập tức; thời gian thoát giảm xuống **~0.15s** và child process không còn bất kỳ worker/side-effect nào chạy ngầm.
3. **Probe A8 (Bounty Classification & Rate Limiting Trust Boundary):**
   - *Trước fix:* Public caller gửi body `{ source: 'test' }` để loại attempt khỏi thống kê; rate limit lưu trong Map RAM bị reset khi serverless instance khởi động lại.
   - *Sau fix:* Public caller gửi `source: 'test'` mà không có `x-bounty-auth-key` khớp với `BOUNTY_INTERNAL_SECRET` trên server sẽ bị cưỡng bức về `source: 'public'`; rate limit truy vấn nguyên tử qua `prisma.bountyAttempt.count` trong cửa sổ 1 phút và 24 giờ, bảo đảm không bị reset khi server khởi động lại.

---

## 5. RỦI RO DỒN TÍCH & DANH MỤC NOT_RUN

Tuân thủ nghiêm ngặt nguyên tắc trung thực khoa học và chỉ thị an toàn của Owner:
1. **NOT_RUN: Live Biometric Hardware Passkey Verification trên Avalanche Fuji:**
   - Đã kiểm chứng: Ranh giới mật mã local browser (`LOCAL_BROWSER_CRYPTO_BOUNDARY`), bao gồm virtual authenticators của Playwright, phần mềm xác thực P-256 ECDSA, DER canonical parser và contract mock precompile.
   - Chưa chạy: Thao tác chạm vân tay/Face ID thực tế trên thiết bị phần cứng để phát broadcast giao dịch lên Fuji C-Chain (yêu cầu sự hiện diện của Owner và thiết bị sinh trắc học vật lý).
2. **NOT_RUN: Live Cross-Chain ICM Packet Broadcast giữa Avalanche Fuji và Dispatch L1:**
   - Đã kiểm chứng: Logic hợp đồng `MissionCrossChainICM.sol` qua 12 test Foundry và fork simulation.
   - Chưa chạy: Giao dịch live chuyển tin Dispatch→Fuji (yêu cầu faucet Dispatch L1 và relayer công khai đang hoạt động).
3. **ON-CHAIN DEPLOYMENT BOUNDARY (Lưu ý về triển khai On-Chain):**
   - Các hợp đồng đã vá trong `contracts/src/` (`GuardedTreasury.sol` với A1 snapshot checks và `PasskeyMissionAuthority.sol` với A3 owner actions) **CHƯA** được deploy lại lên Avalanche Fuji testnet.
   - Địa chỉ Fuji hiện tại (`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`) là bản deploy lịch sử cũ. Không được tái sử dụng các tx lịch sử này để khẳng định code vừa vá đã có trên Fuji; việc deploy bản mới đang chờ lệnh phê duyệt của Owner.
