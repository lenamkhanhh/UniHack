# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG S2/WOW A1..A9)

**Thời điểm:** 2026-11-10 16:05 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Đánh Giá Trước Khi Fix (Reviewer Baseline):** `a8eb591`  
**HEAD Mã Nguồn Đã Kiểm Thử Hoàn Tất:** `671e5d1`  

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **PASS** *(Reviewer đã accept)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `proposeWithProof`; cả `approveProposal` và `executeProposal` từ chối nếu root hiện tại khác snapshot (`require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")`). Handler ghi nhận `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. |
| **A2** | **P1** | **PASS** *(Reviewer đã accept & hoàn tất)* | `520e1da` | `apps/web/lib/webauthn-p256.ts`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/app/missions/new/page.tsx`<br>`apps/web/tests/webauthn-p256.test.ts`<br>`apps/web/tests/passkey-relay.test.ts` | Loại bỏ fallback demo; POST và GET trả về 503 `NOT_CONFIGURED` khi thiếu authority, 503 `UNAVAILABLE` khi lỗi RPC đọc chainId; kiểm tra `rpIdHash == sha256(hostname)`, UV/UP, challenge, mission, cap, nonce; UI chỉ render thẻ xác nhận khi có receipt block metadata xác thực on-chain; DER parser kiểm tra độ dài tổng, biên nguyên, $0 < r,s < N$. Gắn nhãn trung thực `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware live ghi `NOT_RUN`. 24/24 WebAuthn tests pass, 10/10 relay unit tests pass. |
| **A3** | **P1** | **PASS** *(Reviewer đã accept với giới hạn đã ghi)* | `f0fd3b4` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Hành động governance & recovery passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). Ghi rõ giới hạn: `MockP256Precompile` trong Foundry là golden-signature oracle dùng `vm.signP256`, không phải thuật toán EVM curve arithmetic gốc; test negative wrong-private-key và mutated signature pass. 32/32 governance tests pass. |
| **A4** | **P1** | **PASS** | `604104b` | `apps/web/lib/validation-bundle.ts`<br>`apps/web/lib/validator-job.ts`<br>`apps/web/app/api/missions/[slug]/close/route.ts`<br>`apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/tests/m7-validator-automation.test.ts` | Kiểm soát toàn vẹn block bắt đầu scan: thiếu `targetStartBlock` trả về `unverified-missing-start`, dải đảo ngược trả về `invalid-range`, chunked scan ($\le 90$ blocks) quét toàn bộ lịch sử không truncation; route `close` ghi job `QUEUED` bền vững vào DB trong lock order; `buildUnsignedValidationRequest` sinh transaction hoàn chỉnh `{ to, data, value: '0', chainId: 43113 }` cho owner ký; `reconcileOwnerValidationRequestReceipt` xác minh event `ValidationRequest` và chuyển trạng thái; 17/17 tests pass (1 skipped Anvil fork). |
| **A5** | **P1** | **PASS** | *(Proof)* | `.cache/staging-build/`<br>`apps/web/prisma/migrations/`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Clean staging build proof tại thư mục mới `.cache/staging-build` chỉ chứa tracked files từ git archive, sạch hoàn toàn `node_modules`, `packages/guard/dist`, `apps/web/.next`. Toàn bộ 5 migration triển khai sạch trên database rỗng `unihack_review_a5_proof` qua `prisma migrate deploy` (không dùng `db push`). Root build `npm run build` hoàn tất sạch (exit code 0). 17/17 bounty tests pass trên database mới. |
| **A6** | **P2** | **PASS** | `b2a50c5` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Loại bỏ thread fallback; tiến trình con worker `_execute_agentdojo_task_worker` (tương thích Windows spawn) tái tạo suite/LLM/defense bên trong tiến trình và giao tiếp qua non-blocking Pipe (duplex=False) tránh deadlock; timeout ngắt dứt điểm bằng `p.kill()`; map chính xác runner defense keys (`c0`, `c1`, `c2_strict`, `c2_file_trusted`, `c2`) với mã nguồn tham gia; fingerprint mã hóa ràng buộc prompt, attack payload, system prompt, model digest; cờ `--allow-legacy-cache` cô lập hoàn toàn cache lịch sử. 12/12 python tests pass. |
| **A7** | **P2** | **PASS** *(Reviewer đã accept)* | `fea5f20`<br>`dde044e` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts`<br>`apps/web/lib/validator.ts` | Đối chiếu canonical mission ID/slug (`isMissionIdMatch`); tính toán lại Merkle root từ payees đối chiếu `payeeRoot` (fail-closed khi mismatch); ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **PASS** | `937f41a`<br>`7ff11ed` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110120000_bounty_quota_reservation/migration.sql`<br>`apps/web/tests/bounty.test.ts` | Khởi tạo bảng `BountyQuotaReservation`; hàm `reserveBountyQuota` đặt chỗ atomic trong DB bằng `pg_advisory_xact_lock(hashtext(ipHash))` TRƯỚC khi gọi LLM/RPC; DB down tự động fail-closed từ chối suy luận đắt tiền; xác lập ranh giới `TRUSTED_INGRESS` (khi unverified tự động gom vào `shared-public-bucket` chống xoay vòng header); quota chuẩn hóa 300 lượt/ngày toàn cục và 5 lượt/phút/IP; 17/17 tests pass. |
| **A9** | **P2** | **PASS** | `671e5d1` | `DEPLOY_CHECKLIST.md`<br>`SECURITY.md`<br>`FORMAL.md`<br>`REPORT_REVIEW_AND_FIX_COMPLETION.md` | Báo cáo chính xác HEAD tested `671e5d1`; danh sách 5 migration hiện diện thực tế; sửa diễn đạt P256 golden-signature oracle trong test harness Foundry so với RIP-7212 native precompile trên Avalanche C-Chain; xác nhận cơ chế revert string `ProposalPayeePolicyChanged`; kê khai đầy đủ số lượng test và ranh giới `NOT_RUN` bên ngoài. |

---

## 2. KẾT QUẢ KIỂM CHỨNG TOÀN DIỆN (TEST RUN EVIDENCE)

### 2.1 Foundry Smart Contract Test Suite (`contracts/`)
- **Lệnh chạy:** `forge test --summary` (thực hiện bên trong `contracts/`)
- **Kết quả:** **111 Passed / 0 Failed / 0 Skipped** (Toàn bộ 6 suites):
  - `GuardedTreasuryTest`: **43 passed** (bao gồm 5 tests hồi quy A1 `test_A1_*`)
  - `PasskeyGovernanceTest`: **32 passed** (bao gồm kiểm thử P-256 genuine verification, wrong-key negatives, mutated signature, sweep token recovery `test_A3_*`)
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

### 2.2 Guard SDK Test Suite (`packages/guard/`)
- **Lệnh chạy:** `npx vitest run` (thực hiện bên trong `packages/guard/`)
- **Kết quả:** **19 Passed / 0 Failed / 0 Skipped** across 2 files:
  - `tests/guard.test.ts`: **16 passed**
  - `tests/parity.test.ts`: **3 passed**

### 2.3 Web Application Test Suite (`apps/web/`)
- **Lệnh chạy:** `npx vitest run` (thực hiện bên trong `apps/web/`)
- **Kết quả:** **290 Passed / 0 Failed / 1 Skipped (291 total tests across 32 test files)**:
  - `tests/bounty.test.ts`: **17 passed** (bao gồm M7-A8-01..04: concurrent quota reservation, restart isolation, DB failure fail-closed, unverified ingress protection)
  - `tests/m7-validator-automation.test.ts`: **17 tests (16 passed, 1 skipped)** (bao gồm M7-A4-05..11: scan start integrity, durable close job queue, wallet-sendable unsigned request, owner receipt reconciliation)
  - `tests/unit-boundaries.test.ts`: **33 passed**
  - `tests/agent-lifecycle.test.ts`: **20 passed**
  - `tests/p-series.test.ts`: **25 passed**
  - `tests/webauthn-p256.test.ts`: **24 passed**
  - `tests/passkey-relay.test.ts`: **10 passed**
  - `tests/validation-bundle.test.ts`: **8 passed**
  - `tests/handler-lifecycle.test.ts`: **1 passed**
  - `tests/x402-atc26.test.ts`: **10 passed**
  - `tests/arena.test.ts`: **12 passed**
  - Và 21 test files phụ trợ khác: **toàn bộ PASS**.

### 2.4 AgentDojo Benchmark Test Suite (`eval/agentdojo/`)
- **Lệnh chạy:** `./.venv/Scripts/python.exe -m unittest test_provguard_pairs.py`
- **Kết quả:** **12 Passed / 0 Failed / 0 Skipped (19.8s)**:
  - `test_unpicklable_lambda_raises_type_error` [PASS]
  - `test_defense_code_revision_mapping_and_unknown_failure` [PASS]
  - `test_subprocess_worker_large_trace_transport` [PASS] (Windows spawn worker truyền tải 500 tool calls an toàn qua Pipe không deadlock)
  - `test_legacy_cache_isolation` [PASS]
  - `test_timeout_process_isolation` [PASS]
  - Cùng 7 tests kiểm chứng 48 pairs ProvGuard, ASR flags và security semantics: **toàn bộ PASS**.

---

## 3. BẰNG CHỨNG CLEAN STAGING BUILD & DISPOSABLE DATABASE (A5 PROOF)

1. **Khởi tạo staging checkout:**
   - Thư mục đích: `.cache/staging-build`
   - Phương thức: Trích xuất toàn bộ tracked files từ Git HEAD (`git archive --format=zip HEAD`), giải nén sạch.
   - Xác nhận trước khi build:
     - `node_modules`: **ABSENT** (`False`)
     - `packages/guard/dist`: **ABSENT** (`False`)
     - `apps/web/.next`: **ABSENT** (`False`)
     - Không có symlink ngược về workspace chính.

2. **Khởi tạo database rỗng dùng một lần:**
   - Tên database: `unihack_review_a5_proof` (PostgreSQL trên port 55432).
   - Lệnh migration: `npx prisma migrate deploy`
   - Kết quả: Áp dụng thành công toàn bộ **5 migration** sạch từ đầu:
     1. `20261104000000_init`
     2. `20261104100000_round2_hardening`
     3. `20261107120000_payee_root`
     4. `20261110000000_validation_job_and_bounty`
     5. `20261110120000_bounty_quota_reservation`

3. **Thực thi root build:**
   - Lệnh chạy: `npm run build` từ thư mục `.cache/staging-build`
   - Tiến trình:
     1. Xây dựng `@missionpay/guard`: `tsc -p tsconfig.json` -> tạo `packages/guard/dist/`
     2. Xây dựng `apps/web`: `next build` -> biên dịch và tạo thành công 33/33 static pages.
   - Kết quả: **Exit code 0** (Build thành công).

4. **Kiểm thử trên môi trường staging:**
   - Lệnh chạy: `npx vitest run tests/bounty.test.ts` trong `.cache/staging-build/apps/web`
   - Kết quả: **17 passed / 0 failed** trên database mới `unihack_review_a5_proof`.

---

## 4. KÊ KHAI RANH GIỚI VÀ PHẦN CHƯA THỰC THI (EXTERNAL NOT_RUN)

Tuân thủ nghiêm ngặt nguyên tắc trung thực kỹ thuật:
1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey được thực hiện qua WebAuthn virtual authenticator adapter và xác minh mật mã ECDSA P-256 trên phần mềm trong automated suites; chưa thử nghiệm trên thiết bị phần cứng Apple Touch ID / YubiKey với sự hiện diện sinh trắc học trực tiếp của Owner.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Các bản vá mã nguồn hợp đồng trong `contracts/src/` (A1 root snapshot check và A3 passkey governance actions) đã hoàn tất và được kiểm chứng cục bộ. Việc deploy bytecode mới lên Avalanche Fuji chưa được thực hiện vì cần lệnh phê duyệt chính thức từ Owner. Các địa chỉ contract hiện tại trên Fuji (`0x2045...` cho GuardedTreasury và `0x494b...` cho PasskeyMissionAuthority) tiếp tục mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Kiểm thử Foundry cục bộ sử dụng `MockP256Precompile` (đóng vai trò golden-signature lookup oracle qua `vm.signP256`), không phải thực thi native precompile trên EVM mainnet/testnet.
