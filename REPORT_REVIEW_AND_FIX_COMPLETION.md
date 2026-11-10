# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG 4 - HOÀN TẤT A1..A9)

**Thời điểm:** 2026-11-11 02:15 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Đánh Giá Trước Khi Fix (Reviewer Baseline Round 4):** `b7da608`  
**HEAD Mã Nguồn Đã Kiểm Thử & Chốt:** `3fa5ff9`  

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `proposeWithProof`; `approve` và `execute` từ chối nếu root khác snapshot (`require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")`). Handler ghi `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. Địa chỉ Fuji lịch sử là `OLD_DEPLOYMENT`. |
| **A2** | **P1** | **RESOLVED** | `4955a99`<br>`f644dec` | `apps/web/e2e/passkey.spec.ts`<br>`apps/web/app/missions/new/page.tsx`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/lib/webauthn-p256.ts`<br>`apps/web/tests/passkey-relay.test.ts` | Sửa dynamic origin trong test RP ID (`currentOrigin` từ request/URL, giữ nguyên verify RP mismatch không gọi `credentials.get`). Adapter mật mã P-256 độc lập xác minh ECDSA trên `authenticatorData \|\| sha256(clientDataJSON)`, từ chối sai key, sai signature, tráo mission/nonce/cap. UI phân biệt rõ ràng simulation và confirmed card. 6/6 Playwright browser tests pass trên port 3138; 24/24 WebAuthn tests pass; 11/11 relay unit tests pass. Nhãn `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware ghi `NOT_RUN`. |
| **A3** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `1981c21` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Quyền governance và recovery qua passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). Ghi nhận giới hạn kỹ thuật: `MockP256Precompile` trong Foundry là golden-signature oracle dùng `vm.signP256`; test negative wrong-private-key và mutated signature pass. 32/32 tests pass. |
| **A4** | **P1** | **RESOLVED** | `7e841bf`<br>`3fa5ff9` | `apps/web/lib/validator-job.ts`<br>`apps/web/lib/validation-bundle.ts`<br>`apps/web/app/api/missions/[slug]/close/route.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/app/verify/[missionId]/page.tsx`<br>`apps/web/scripts/process-validation-jobs.ts`<br>`apps/web/app/api/missions/[slug]/creation-receipt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110180000_validation_state_machine_and_context/`<br>`apps/web/tests/m7-validator-automation.test.ts` | State machine bền vững: (1) Ví -> API với kiểm tra chain 43113, `value: '0x0'`, dual Bearer/EIP-191 challenge; (2) Frozen context: serialize đầy đủ bundle, provenance, identities, phát hiện biến đổi -> `STALE_CONTEXT`; (3) Worker lease bao trùm mọi trạng thái non-terminal với `leaseToken` fencing; (4) Ngăn chặn triệt để double-send: `responseTxHash` được lưu ngay, timeout/re-submit chỉ đối soát receipt, không gọi lại `writeContract`; (5) Trạng thái bền vững, DB outage trả về 503 `DATABASE_UNAVAILABLE`, không fallback cache RAM; (6) Đọc chính xác `getValidationStatus` on-chain (`chainScore`, `chainTag`, `responseHash`) tách biệt với local score; (7) Đối soát `creationReceipt` hỗ trợ authority router recipient (`emitter == treasury`); (8) CLI worker tin cậy, nạp env trước dynamic import, giới hạn bounded 1..100, thoát mã nonzero khi có job lỗi. 33 tests (32 passed, 1 skipped live fork). |
| **A5** | **P1** | **RESOLVED** | `3fa5ff9` | `apps/web/prisma/migrations/`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Clean staging build proof: Root `npm run build` (build `@missionpay/guard` trước rồi build `apps/web`) hoàn tất thành công (Exit code 0, 33/33 routes). Database sạch dùng một lần `unihack_review_r4_proof` áp dụng trọn vẹn toàn bộ 7 migration qua `prisma migrate deploy` (không dùng `db push`). 50 tests (`bounty.test.ts` + `m7-validator-automation.test.ts`) pass trên database mới. |
| **A6** | **P2** | **RESOLVED** | `4955a99` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Fingerprint môi trường suite và tool schemas thực tế; thu thập chính xác counters từ tiến trình con worker (`api_calls`, `api_errors`, `trace`); timeout/error không bịa đặt số đếm; chế độ legacy cache hoàn toàn cô lập phục vụ báo cáo lịch sử ngoại tuyến, không trộn lẫn kết quả run mới. 14/14 Python tests pass. |
| **A7** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `fea5f20`<br>`dde044e` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts` | Đối chiếu canonical mission ID/slug; đối chiếu Merkle root từ payees; ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `467e251`<br>`937f41a`<br>`b7da608` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110120000_bounty_quota_reservation/`<br>`apps/web/tests/bounty.test.ts` | Atomic PostgreSQL reservation rate limiting: global advisory lock trước IP lock, tuần tự hóa nghiêm ngặt tại ngưỡng 299; bảo lưu khấu trừ hạn ngạch độc lập với kết quả/lease; DB down fail-closed; reverse proxy `TRUSTED_INGRESS` chống giả mạo header; offline simulation stub. 18/18 tests pass. |
| **A9** | **P2** | **RESOLVED** | `DEPLOY_CHECKLIST.md`<br>`REPORT_REVIEW_AND_FIX_COMPLETION.md` | `DEPLOY_CHECKLIST.md` cập nhật danh sách đầy đủ 7 migration, lệnh chạy worker CLI `npm --prefix apps/web run worker:validation`, placeholders cấu hình; đồng bộ test counts thực tế; kê khai rõ ràng ranh giới `NOT_RUN` bên ngoài. |

---

## 2. KẾT QUẢ KIỂM THỬ TOÀN DIỆN (FULL TEST RUN EVIDENCE)

### 2.1 Smart Contracts (`contracts/`)
- **Lệnh chạy:** `forge test --summary`
- **Kết quả:** **111 Passed / 0 Failed / 0 Skipped** (Toàn bộ 6 suites):
  - `GuardedTreasuryTest`: **43 passed**
  - `PasskeyGovernanceTest`: **32 passed**
  - `PasskeyMissionAuthorityTest`: **16 passed**
  - `MissionCrossChainICMTest`: **12 passed**
  - `ValidationRegistryTest`: **7 passed**
  - `GuardedTreasuryInvariantTest`: **1 passed** (6 stateful invariants, **512 runs / 32,768 calls / 0 reverts**)

### 2.2 Guard SDK (`packages/guard/`)
- **Lệnh chạy:** `npm test`
- **Kết quả:** **19 Passed / 0 Failed / 0 Skipped** (2 test files: `guard.test.ts`, `parity.test.ts`).

### 2.3 Web Application (`apps/web/`)
- **Lệnh chạy:** `npx.cmd vitest run`
- **Kết quả:** **308 Passed / 0 Failed / 1 Skipped** (309 total tests across 32 test files).
  - Bao gồm `tests/m7-validator-automation.test.ts`: **32 passed / 1 skipped** (M7-A4-01 đến M7-A4-27).
  - Bao gồm `tests/bounty.test.ts`: **18 passed / 0 failed**.
  - Bao gồm `tests/passkey-relay.test.ts`: **11 passed / 0 failed**.

### 2.4 Browser E2E Playwright Suite (`apps/web/e2e/passkey.spec.ts`)
- **Lệnh chạy:** `set "PLAYWRIGHT_TEST_PORT=3138" && npx.cmd playwright test e2e/passkey.spec.ts --project=ui-mocked`
- **Kết quả:** **6 Passed / 0 Failed** trên port 3138 độc lập:
  - `User cancellation does NOT succeed and displays error deterministically` [PASS]
  - `Virtual Authenticator registers P-256 passkey, extracts coordinates, and authorizes two sequential missions via real cryptographic boundary adapter` [PASS]
  - `UI refuses known RP ID / origin mismatch before credentials.get` [PASS]
  - `Adversarial negatives against cryptographic adapter: wrong signature, wrong key, wrong nonce, altered mission` [PASS]
  - `UI State Boundaries: Simulation success renders simulation badge and does NOT render confirmed card` [PASS]
  - `UI State Boundaries: Missing receipt fields or RPC failure does NOT show confirmed success card or message` [PASS]

### 2.5 AgentDojo Benchmark (`eval/agentdojo/`)
- **Lệnh chạy:** `eval\agentdojo\.venv\Scripts\python.exe -m unittest eval/agentdojo/test_provguard_pairs.py`
- **Kết quả:** **14 Passed / 0 Failed / 0 Skipped** (21.0s).

---

## 3. BẰNG CHỨNG CLEAN STAGING BUILD & DISPOSABLE DATABASE (A5 PROOF)

1. **Root Build Proof:**
   - Lệnh: `npm run build` từ root
   - Tiến trình: `@missionpay/guard` build (`tsc -p tsconfig.json`) -> `apps/web` build (`next build`).
   - Kết quả: **Exit code 0**, biên dịch thành công 33/33 routes tĩnh và động, không lỗi TypeScript hay linter.

2. **Disposable Database Migration Proof:**
   - Database dùng một lần: `unihack_review_r4_proof` trên PostgreSQL port 55432.
   - Lệnh: `npx.cmd prisma migrate deploy --schema=apps/web/prisma/schema.prisma`
   - Kết quả: Áp dụng thành công toàn bộ **7 migration** sạch từ đầu:
     1. `20261104000000_init`
     2. `20261104100000_round2_hardening`
     3. `20261107120000_payee_root`
     4. `20261110000000_validation_job_and_bounty`
     5. `20261110120000_bounty_quota_reservation`
     6. `20261110150000_validation_job_leases`
     7. `20261110180000_validation_state_machine_and_context`
   - Kiểm thử độc lập trên `unihack_review_r4_proof`: `tests/bounty.test.ts` và `tests/m7-validator-automation.test.ts` đạt **50 passed / 1 skipped**.

---

## 4. KÊ KHAI RANH GIỚI KỸ THUẬT & EXTERNAL NOT_RUN

1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey được thực hiện qua WebAuthn virtual authenticator và adapter ECDSA P-256 độc lập; chưa thử nghiệm trên thiết bị phần cứng Apple Touch ID / YubiKey thực tế.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Các bản vá mã nguồn contract trong `contracts/src/` đã hoàn tất và được kiểm chứng cục bộ qua Foundry. Việc deploy bytecode mới lên Avalanche Fuji chưa được thực hiện vì cần lệnh phê duyệt chính thức từ Owner. Các địa chỉ contract hiện tại trên Fuji (`0x2045...` cho GuardedTreasury và `0x494b...` cho PasskeyMissionAuthority) tiếp tục mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Kiểm thử Foundry cục bộ sử dụng `MockP256Precompile` (đóng vai trò golden-signature lookup oracle qua `vm.signP256`), không phải thực thi native precompile trên EVM mainnet/testnet.
