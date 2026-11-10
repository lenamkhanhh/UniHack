# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG 3 - A1..A9)

**Thời điểm:** 2026-11-10 19:15 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Đánh Giá Trước Khi Fix (Reviewer Baseline):** `4c80954`  
**HEAD Mã Nguồn Đã Kiểm Thử Hoàn Tất:** `f644dec`  

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `proposeWithProof`; cả `approveProposal` và `executeProposal` từ chối nếu root hiện tại khác snapshot (`require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")`). Handler ghi nhận `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. Địa chỉ Fuji lịch sử chưa cập nhật. |
| **A2** | **P1** | **RESOLVED** | `f644dec`<br>`520e1da` | `apps/web/app/missions/new/page.tsx`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/lib/webauthn-p256.ts`<br>`apps/web/tests/passkey-relay.test.ts`<br>`apps/web/tests/webauthn-p256.test.ts`<br>`apps/web/e2e/passkey.spec.ts` | Loại bỏ fallback demo; POST relay fail-closed trả về 503 `NOT_CONFIGURED` khi thiếu authority, 503 `UNAVAILABLE` khi lỗi RPC đọc chainId; kiểm tra `rpIdHash == sha256(hostname)` và `expectedOrigin` trước `credentials.get`; UI tách biệt thẻ simulation (`passkey-simulation-card`) với thẻ confirmed (`passkey-confirmed-card`), chỉ render confirmed khi có `receipt.blockNumber` và `txHash`; adapter mật mã độc lập kiểm tra WebAuthn P-256; test adversarial (sai signature, sai key, sai nonce, tráo mission -> 400). Gắn nhãn trung thực `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware live ghi `NOT_RUN`. 24/24 WebAuthn tests pass, 11/11 relay unit tests pass, Playwright browser suite pass. |
| **A3** | **P1** | **ACCEPTED** *(Reviewer đã accept với giới hạn)* | `1981c21` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Hành động governance & recovery passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). Ghi rõ giới hạn kỹ thuật: `MockP256Precompile` trong Foundry là golden-signature oracle dùng `vm.signP256`, không phải thuật toán EVM curve arithmetic gốc; test negative wrong-private-key và mutated signature pass. 32/32 governance tests pass. |
| **A4** | **P1** | **RESOLVED** | `3c89bdf`<br>`604104b` | `apps/web/lib/validation-bundle.ts`<br>`apps/web/lib/validator-job.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/missions/[slug]/close/route.ts`<br>`apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110150000_validation_job_leases/migration.sql`<br>`apps/web/scripts/worker-validation.ts`<br>`apps/web/package.json`<br>`apps/web/tests/m7-validator-automation.test.ts` | Xác thực `creationBlock` từ receipt/event `MissionCreated` khớp chainId, treasury và missionId thay vì tin người dùng gửi lên; serialize BigInt `creationBlock` qua DTO string tránh lỗi runtime; atomic conditional worker claim (`QUEUED` -> processing với `leaseToken`), tự động reclaim lease khi worker crash, ngăn race condition đa worker; route `close` persist job bền vững và không nuốt lỗi DB; `runMissionValidatorJob` ghi nhận trạng thái evaluation trước khi broadcast; `reconcileOwnerValidationRequestReceipt` đối chiếu đầy đủ registry, chainId, sender/owner, matching event validatorAddress, agentId, requestHash; loại bỏ hoàn toàn mặc định điểm cao (`job.score ?? 100` bị xóa, từ chối broadcast khi chưa có evaluation); bổ sung worker CLI executable `npm --prefix apps/web run worker:validation`. 26 tests (25 passed, 1 skipped Anvil fork). |
| **A5** | **P1** | **RESOLVED** | *(Proof)* | `.cache/staging-build/`<br>`apps/web/prisma/migrations/`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Clean staging build proof tại thư mục mới `.cache/staging-build` chỉ chứa tracked files từ git archive tại HEAD `f644dec`, sạch hoàn toàn `node_modules`, `packages/guard/dist`, `apps/web/.next`. Toàn bộ 6 migration triển khai sạch trên database rỗng `unihack_review_a5_proof` qua `prisma migrate deploy` (không dùng `db push`). Root build `npm run build` hoàn tất sạch (exit code 0). 18/18 bounty tests pass trên database mới. |
| **A6** | **P2** | **RESOLVED** | `4819db7`<br>`b2a50c5` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Tiến trình con worker `_execute_agentdojo_task_worker` (tương thích Windows spawn) trả về đầy đủ `api_calls`, `api_errors` và `trace`; hỗ trợ backend `offline_stub` kiểm thử ranh giới worker không cần mạng; kiểm tra tính tuần tự hóa qua `pickle.dumps` (chặn lambda); tiến trình cha tổng hợp counters của tiến trình con vào cache JSON và stats tổng kết; task lỗi/timeout được tính `api_calls += 1; api_errors += 1` (không âm thầm ghi 0); `get_defense_code_revision` liên kết cả `run_benchmark.py` vào tất cả runner configs (`c0`, `c1`, `c2_strict`, `c2_file_trusted`); `get_task_suite_fingerprint` liên kết tool definitions, parameters, docs của bộ suite cài đặt; model digest unavailable được ghi rõ `"unavailable"` (không bịa đặt); cờ `--allow-legacy-cache` cô lập hoàn toàn thành chế độ audit lịch sử ngoại tuyến (`comparable_to_fresh = False`). 14/14 python tests pass. |
| **A7** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `fea5f20`<br>`dde044e` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts`<br>`apps/web/lib/validator.ts` | Đối chiếu canonical mission ID/slug (`isMissionIdMatch`); tính toán lại Merkle root từ payees đối chiếu `payeeRoot` (fail-closed khi mismatch); ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **RESOLVED** | `467e251`<br>`937f41a`<br>`7ff11ed` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110120000_bounty_quota_reservation/migration.sql`<br>`apps/web/tests/bounty.test.ts` | Tuần tự hóa đồng thời bằng global advisory lock (`pg_advisory_xact_lock(431130001)`) TRƯỚC IP lock trong transaction PostgreSQL, loại bỏ triệt để race condition vượt trần toàn cục tại ngưỡng 299; bảo lưu khấu trừ hạn ngạch dựa trên thời điểm bắt đầu request độc lập với trạng thái kết quả/hết hạn lease (lượt FAILED/EXPIRED vẫn tính vào quota window, chống retry miễn phí); hỗ trợ stub mô phỏng ngoại tuyến (`SIMULATE_TRANSACTION_PAYOUT_STUB=true`) tách biệt kiểm thử local khỏi biến động mạng Fuji RPC; chuẩn hóa 300 lượt/ngày toàn cục và 5 lượt/phút/IP; tài liệu hóa ranh giới reverse proxy `TRUSTED_INGRESS` chống giả mạo header. 18/18 tests pass. |
| **A9** | **P2** | **RESOLVED** | *(Docs)* | `DEPLOY_CHECKLIST.md`<br>`SECURITY.md`<br>`FORMAL.md`<br>`README.md`<br>`JUDGE_QA.md`<br>`REPORT_REVIEW_AND_FIX_COMPLETION.md` | Cập nhật đầy đủ danh sách 6 migration; bổ sung lệnh chạy Validation Job Worker CLI và biến cấu hình; đồng bộ số lượng test thực tế (Foundry 111, Guard SDK 19, Web App 301/1 skip, Python 14); ghi nhận chính xác trạng thái contract deploy trên Fuji là `OLD_DEPLOYMENT`; kê khai ranh giới `NOT_RUN` bên ngoài. |

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
- **Kết quả:** **301 Passed / 0 Failed / 1 Skipped (302 total tests across 32 test files)**:
  - `tests/bounty.test.ts`: **18 passed** (bao gồm M7-A8-01..05: concurrent global quota serialization tại ngưỡng 299 với barrier, bảo lưu quota khi work thất bại, restart persistence, DB down fail-closed, unverified ingress protection, offline simulation stub)
  - `tests/m7-validator-automation.test.ts`: **26 tests (25 passed, 1 skipped)** (bao gồm M7-A4-01..16: receipt-confirmed creation start, forged start rejection, BigInt DTO serialization, atomic worker claim lease với compound index, crash lease reclaim, DB failure rollback, owner receipt validation, không defaults điểm 100/verified-full khi chưa evaluate, CLI worker execution smoke)
  - `tests/passkey-relay.test.ts`: **11 passed** (bao gồm POST negative tests trả về 503 `NOT_CONFIGURED` khi thiếu authority, kiểm tra chainId fail-closed)
  - `tests/unit-boundaries.test.ts`: **33 passed**
  - `tests/agent-lifecycle.test.ts`: **20 passed**
  - `tests/p-series.test.ts`: **25 passed**
  - `tests/webauthn-p256.test.ts`: **24 passed**
  - `tests/validation-bundle.test.ts`: **8 passed**
  - `tests/handler-lifecycle.test.ts`: **1 passed**
  - `tests/x402-atc26.test.ts`: **10 passed**
  - `tests/arena.test.ts`: **12 passed**
  - Và 21 test files phụ trợ khác: **toàn bộ PASS**.

### 2.4 AgentDojo Benchmark Test Suite (`eval/agentdojo/`)
- **Lệnh chạy:** `./.venv/Scripts/python.exe -m unittest test_provguard_pairs.py`
- **Kết quả:** **14 Passed / 0 Failed / 0 Skipped (33.8s)**:
  - `test_unpicklable_lambda_raises_type_error` [PASS]
  - `test_defense_code_revision_mapping_and_unknown_failure` [PASS]
  - `test_subprocess_worker_large_trace_transport` [PASS] (Windows spawn worker truyền tải 500 tool calls an toàn qua Pipe không deadlock)
  - `test_legacy_cache_isolation` [PASS]
  - `test_timeout_process_isolation` [PASS]
  - `test_subprocess_agentdojo_worker_offline_stub_counters_and_trace` [PASS] (Kiểm tra worker subprocess thực tế với offline stub trả về api_calls, api_errors và trace)
  - `test_suite_environment_and_harness_mutation_invalidates_fingerprint` [PASS] (Đột biến runner harness, policy hoặc suite environment đều vô hiệu hóa cache fingerprint)
  - Cùng 7 tests kiểm chứng 48 pairs ProvGuard, ASR flags và security semantics: **toàn bộ PASS**.

---

## 3. BẰNG CHỨNG CLEAN STAGING BUILD & DISPOSABLE DATABASE (A5 PROOF)

1. **Khởi tạo staging checkout:**
   - Thư mục đích: `.cache/staging-build`
   - Phương thức: Trích xuất toàn bộ tracked files từ Git HEAD `f644dec` (`git archive --format=zip HEAD`), giải nén sạch.
   - Xác nhận trước khi build:
     - `node_modules`: **ABSENT** (`False`)
     - `packages/guard/dist`: **ABSENT** (`False`)
     - `apps/web/.next`: **ABSENT** (`False`)
     - Không có symlink ngược về workspace chính.

2. **Cài đặt dependencies và thực thi root build:**
   - Lệnh cài đặt: `npm install` trong `.cache/staging-build` (347 packages được cài mới).
   - Lệnh build: `npm run build` từ thư mục `.cache/staging-build`.
   - Tiến trình:
     1. Xây dựng `@missionpay/guard`: `tsc -p tsconfig.json` -> tạo `packages/guard/dist/`.
     2. Xây dựng `apps/web`: `next build` -> biên dịch và tạo thành công 33/33 static pages.
   - Kết quả: **Exit code 0** (Build thành công).
   - Xác nhận sau build:
     - `packages/guard/dist`: **PRESENT** (`True`).
     - `apps/web/.next`: **PRESENT** (`True`).

3. **Khởi tạo database rỗng dùng một lần:**
   - Tên database: `unihack_review_a5_proof` (PostgreSQL trên port 55432).
   - Lệnh migration: `npx prisma migrate deploy`
   - Kết quả: Áp dụng thành công toàn bộ **6 migration** sạch từ đầu:
     1. `20261104000000_init`
     2. `20261104100000_round2_hardening`
     3. `20261107120000_payee_root`
     4. `20261110000000_validation_job_and_bounty`
     5. `20261110120000_bounty_quota_reservation`
     6. `20261110150000_validation_job_leases`

4. **Kiểm thử trên môi trường staging:**
   - Lệnh chạy: `npx vitest run tests/bounty.test.ts` trong `.cache/staging-build/apps/web`
   - Kết quả: **18 passed / 0 failed** trên database mới `unihack_review_a5_proof`.

---

## 4. KÊ KHAI RANH GIỚI VÀ PHẦN CHƯA THỰC THI (EXTERNAL NOT_RUN)

Tuân thủ nghiêm ngặt nguyên tắc trung thực kỹ thuật:
1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey được thực hiện qua WebAuthn virtual authenticator adapter và xác minh mật mã ECDSA P-256 trên phần mềm trong automated suites; chưa thử nghiệm trên thiết bị phần cứng Apple Touch ID / YubiKey với sự hiện diện sinh trắc học trực tiếp của Owner.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Các bản vá mã nguồn hợp đồng trong `contracts/src/` (A1 root snapshot check và A3 passkey governance actions) đã hoàn tất và được kiểm chứng cục bộ. Việc deploy bytecode mới lên Avalanche Fuji chưa được thực hiện vì cần lệnh phê duyệt chính thức từ Owner. Các địa chỉ contract hiện tại trên Fuji (`0x2045...` cho GuardedTreasury và `0x494b...` cho PasskeyMissionAuthority) tiếp tục mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Kiểm thử Foundry cục bộ sử dụng `MockP256Precompile` (đóng vai trò golden-signature lookup oracle qua `vm.signP256`), không phải thực thi native precompile trên EVM mainnet/testnet.
