# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG 7 - HOÀN TẤT TRIỆT ĐỂ A1..A9)

**Thời điểm:** 2026-11-11 11:05 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Đánh Giá Trước Khi Fix (Reviewer Baseline Round 7):** `1764b5b`  
**HEAD Mã Nguồn Đã Sửa & Kiểm Thử Toàn Diện (Round 7 Fix):** Working Tree (`feat/s1-app`)

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `proposeWithProof`; `approve` và `execute` từ chối nếu root khác snapshot (`require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")`). Handler ghi `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. Địa chỉ Fuji lịch sử là `OLD_DEPLOYMENT`. |
| **A2** | **P1** | **RESOLVED** | `4955a99`<br>`f644dec` | `apps/web/e2e/passkey.spec.ts`<br>`apps/web/app/missions/new/page.tsx`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/lib/webauthn-p256.ts`<br>`apps/web/tests/passkey-relay.test.ts` | Sửa dynamic origin trong test RP ID (`currentOrigin` từ request/URL, giữ nguyên verify RP mismatch không gọi `credentials.get`). Adapter mật mã P-256 độc lập xác minh ECDSA trên `authenticatorData \|\| sha256(clientDataJSON)`, từ chối sai key, sai signature, tráo mission/nonce/cap. UI phân biệt rõ ràng simulation và confirmed card. 7/7 Playwright browser tests pass trên port 3138; 24/24 WebAuthn tests pass; 11/11 relay unit tests pass. Nhãn `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware ghi `NOT_RUN`. |
| **A3** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `1981c21` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Quyền governance và recovery qua passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). Ghi nhận giới hạn kỹ thuật: `MockP256Precompile` trong Foundry là golden-signature oracle dùng `vm.signP256`; test negative wrong-private-key và mutated signature pass. 32/32 tests pass. |
| **A4** | **P1** | **RESOLVED** *(Round 7: No writeContract fallback, serialized advisory xact lock nonce, privacy boundary)* | Current (`feat/s1-app`) | `apps/web/lib/validator-job.ts`<br>`apps/web/tests/m7-validator-automation.test.ts` | **Khắc phục triệt để 3 khiếm khuyết Round 7:**<br>1. **Xóa bỏ hoàn toàn fallback `writeContract`:** Loại bỏ triệt để nhánh fallback `writeContract` ở cả luồng phát sóng ban đầu lẫn luồng phát sóng lại (rebroadcast). Nếu client phát sóng không hỗ trợ `sendRawTransaction`, worker fail-closed: giữ nguyên trạng thái `RESPONSE_PENDING`, ghi nhận `failureReason` rõ ràng, không gửi bất kỳ giao dịch nào (0 sends) và giữ nguyên `responseTxHash` đã ký trong DB (M7-A4-34).<br>2. **Tuần tự hóa cấp phát nonce bằng `pg_advisory_xact_lock`:** Hàm `reserveValidatorNonce` thực thi trong một `prisma.$transaction` duy nhất với câu lệnh tham số hóa `SELECT pg_advisory_xact_lock(hashtext(${...}))`. Nonce được ghi nhận bền vững vào `frozenContext` (`reservedNonce` + `reservedAt`) trước khi transaction commit. Nếu RPC đếm nonce hoặc DB gặp lỗi, ném ngoại lệ fail-closed (giữ job ở `RESPONSE_PENDING`, tuyệt đối không fallback âm thầm về nonce 0). Kiểm chứng 2 job chạy đồng thời cấp phát đúng 2 nonce riêng biệt (N và N+1) và RPC lỗi hủy ký (M7-A4-35).<br>3. **Bảo mật chuỗi byte ký `rawTransaction`:** Xác minh qua kiểm thử tự động rằng `rawTransaction` và `frozenContext` không bao giờ bị lộ qua bất kỳ API route nào (`/api/verify/*`, `/api/missions/*`) hay in ra console log (M7-A4-36).<br>**Kết quả:** 41 passed / 0 failed / 1 skipped (42 tests) trong `m7-validator-automation.test.ts`. |
| **A5** | **P1** | **RESOLVED** | `3fa5ff9` | `apps/web/prisma/migrations/`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Clean staging build proof: Root `npm run build` hoàn tất thành công (Exit code 0, 33/33 routes). Database sạch áp dụng trọn vẹn toàn bộ 7 migration qua `prisma migrate deploy` (không dùng `db push`). `tsc --noEmit -p apps/web/tsconfig.json` không có lỗi. |
| **A6** | **P2** | **RESOLVED** | `4955a99` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Fingerprint môi trường suite và tool schemas thực tế; thu thập chính xác counters từ tiến trình con worker (`api_calls`, `api_errors`, `trace`); timeout/error không bịa đặt số đếm; chế độ legacy cache hoàn toàn cô lập phục vụ báo cáo lịch sử ngoại tuyến. 14/14 Python tests pass. |
| **A7** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `fea5f20`<br>`dde044e` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts` | Đối chiếu canonical mission ID/slug; đối chiếu Merkle root từ payees; ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `467e251`<br>`937f41a`<br>`b7da608` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110120000_bounty_quota_reservation/`<br>`apps/web/tests/bounty.test.ts` | Atomic PostgreSQL reservation rate limiting: global advisory lock trước IP lock, tuần tự hóa nghiêm ngặt tại ngưỡng 299; bảo lưu khấu trừ hạn ngạch độc lập với kết quả/lease; DB down fail-closed; reverse proxy `TRUSTED_INGRESS` chống giả mạo header; offline simulation stub. 18/18 tests pass. |
| **A9** | **P2** | **RESOLVED** | Current (`feat/s1-app`) | `REPORT_REVIEW_AND_FIX_COMPLETION.md`<br>`DEPLOY_CHECKLIST.md` | Cập nhật đầy đủ bằng chứng kiểm thử Round 7 (41 unit tests M7, 29 bounty/relay tests, 7 browser Playwright tests); mô tả chi tiết giải pháp xóa fallback writeContract, cấp phát nonce nguyên tử bằng advisory xact lock, và kiểm chứng ranh giới quyền riêng tư của raw bytes; xác nhận không push public, không broadcast Fuji testnet, không commit secret; kê khai ranh giới `NOT_RUN` rõ ràng. |

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
- **Lệnh chạy:** `npx.cmd vitest run --root packages/guard`
- **Kết quả:** **19 Passed / 0 Failed / 0 Skipped** (2 test files: `guard.test.ts`, `parity.test.ts`).

### 2.3 Web Application (`apps/web/`)
- **Lệnh chạy:** `& .\node_modules\.bin\vitest.cmd run --root apps/web tests/m7-validator-automation.test.ts`
- **Kết quả:** **41 Passed / 0 Failed / 1 Skipped** (42 total tests trong suite M7):
  - M7-A4-31: Locally prepared and signed raw EVM transaction: hash matches `keccak256(rawTx)`, same bytes rebroadcast on crash, single tx identity [PASS]
  - M7-A4-32: Truly frozen evidence & identities: rejects mutated identities with STALE_CONTEXT and reuses frozen evidence hash without re-scan [PASS]
  - M7-A4-33: Strict chain response verification: rejects malformed tuple hashes (`0x0`, zero bytes32), absent event emitter (`log.address != registryAddress`), different event hash/tag, and distinguishes external response [PASS]
  - **M7-A4-34 (New Round 7):** Raw transport unavailable: client lacking `sendRawTransaction` results in 0 sends, job status stays `RESPONSE_PENDING`, persisted `responseTxHash` unchanged across initial and rebroadcast attempts [PASS]
  - **M7-A4-35 (New Round 7):** Nonce allocation serialization: concurrent jobs acquire distinct serialized nonces via single-transaction `pg_advisory_xact_lock` against PostgreSQL; RPC count failure aborts signing and fails closed without defaulting to nonce 0 [PASS]
  - **M7-A4-36 (New Round 7):** Privacy boundary verification: raw transaction bytes and frozen context are never exposed via API endpoints (`/api/verify/[missionId]`, `/api/missions/[slug]`) or printed in logs [PASS]
- **Lệnh chạy:** `& .\node_modules\.bin\vitest.cmd run --root apps/web tests/bounty.test.ts tests/passkey-relay.test.ts`
- **Kết quả:** **29 Passed / 0 Failed** (18 bounty tests, 11 passkey-relay tests).
- **TypeScript Compiler Check:** `& .\node_modules\.bin\tsc.cmd --noEmit -p apps\web\tsconfig.json`
- **Kết quả:** **Exit code 0** (0 errors).

### 2.4 Browser E2E Playwright Suite (`apps/web/e2e/passkey.spec.ts`)
- **Lệnh chạy:** `npx.cmd playwright test e2e/passkey.spec.ts`
- **Kết quả:** **7 Passed / 0 Failed** (1.5m trên headless Chromium):
  1. `User cancellation does NOT succeed and displays error deterministically (A2-R6)` [PASS]
  2. `Virtual Authenticator registers P-256 passkey, extracts coordinates, and authorizes two sequential missions via real cryptographic boundary adapter (A2-R4, A2-R6)` [PASS]
  3. `UI refuses known RP ID / origin mismatch before credentials.get (A2-R2)` [PASS]
  4. `Adversarial negatives against cryptographic adapter: wrong signature, wrong key, wrong nonce, altered mission (A2-R4, A2-R6)` [PASS]
  5. `UI State Boundaries: Simulation success renders simulation badge and does NOT render confirmed card (A2-R3)` [PASS]
  6. `UI State Boundaries: Missing receipt fields or RPC failure does NOT show confirmed success card or message (A2-R3)` [PASS]
  7. `A4-Gap-5: Wallet pending flow on verify page: unmined -> reload -> mined reconciliation (sendTransaction count 1); wrong/unknown chain sends 0` [PASS]

### 2.5 AgentDojo Benchmark (`eval/agentdojo/`)
- **Lệnh chạy:** `eval\agentdojo\.venv\Scripts\python.exe -m unittest eval/agentdojo/test_provguard_pairs.py`
- **Kết quả:** **14 Passed / 0 Failed / 0 Skipped** (33.2s).

---

## 3. CHI TIẾT SỬA LỖI ROUND 7 (A4 DEFECTS RESOLVED)

1. **Xóa bỏ hoàn toàn fallback `writeContract`:**
   - Trong `apps/web/lib/validator-job.ts`, đã loại bỏ hoàn toàn các dòng lệnh gọi `(broadcastClient as any).writeContract(...)` ở cả luồng gửi lần đầu và luồng phát sóng lại.
   - Nếu `typeof broadcastClient?.sendRawTransaction !== 'function'`, worker cập nhật job với `status: 'RESPONSE_PENDING'`, `failureReason: 'Raw transaction transport (sendRawTransaction) unavailable on broadcast client'`, giải phóng lease và dừng lại. Không có giao dịch thay thế nào được ký hoặc gửi.
   - Xác nhận bằng kiểm thử `M7-A4-34`: Client không có `sendRawTransaction` dẫn tới 0 lần gửi (zero sends), trạng thái vẫn là `RESPONSE_PENDING`, và `responseTxHash` đã ký trước đó được bảo toàn nguyên vẹn.

2. **Tuần tự hóa cấp phát nonce bằng `pg_advisory_xact_lock`:**
   - Thay thế session-level lock rời rạc bằng `reserveValidatorNonce` thực thi bên trong một giao dịch `prisma.$transaction`.
   - Sử dụng câu lệnh SQL tham số hóa an toàn: `tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'validator_nonce:' + valAddrLower}))``. Khóa này tồn tại trong suốt transaction và tự động giải phóng khi transaction commit hoặc rollback, ngăn chặn hoàn toàn rò rỉ lock qua connection pool.
   - Nonce phân bổ được tính toán bằng `Math.max(onChainCount, maxAllocatedNonce + 1)` và được cập nhật bền vững vào trường `frozenContext` (`reservedNonce`, `reservedAt`) của chính bản ghi `validationJob` trước khi transaction hoàn tất.
   - Khi `getTransactionCount` gặp lỗi mạng hoặc lỗi RPC, hàm ném ngoại lệ fail-closed; worker giữ nguyên job ở trạng thái `RESPONSE_PENDING` và hủy bỏ bước ký giao dịch, tuyệt đối không âm thầm gán nonce 0.
   - Hỗ trợ tiêm `nonceAllocator` cho môi trường kiểm thử.
   - Xác nhận bằng kiểm thử `M7-A4-35`: Hai job đồng thời nhận hai nonce phân biệt (10 và 11) không bị xung đột, và khi RPC ném lỗi thì quá trình ký bị hủy bỏ, `responseTxHash` vẫn là null.

3. **Bảo mật tuyệt đối chuỗi bytes ký `rawTransaction`:**
   - Xác minh toàn bộ các API route (`/api/verify/[missionId]`, `/api/missions/[slug]`, v.v.) chỉ trả về các trường được định nghĩa nghiêm ngặt trong allowlist DTO (`toMissionDto`, `toOperationDto`).
   - Trường `frozenContext` và chuỗi `rawTransaction` hoàn toàn không bao giờ xuất hiện trong response JSON của bất kỳ endpoint nào.
   - Các lệnh logging trong worker không in chuỗi byte giao dịch đã ký ra console.
   - Xác nhận bằng kiểm thử `M7-A4-36`: Tìm kiếm sâu trên response text của các API endpoint xác nhận không chứa byte hex `rawTransaction` hay trường `frozenContext`.

---

## 4. KÊ KHAI RANH GIỚI KỸ THUẬT & EXTERNAL NOT_RUN

1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey được thực hiện qua WebAuthn virtual authenticator và adapter ECDSA P-256 độc lập; chưa thử nghiệm trên thiết bị phần cứng Apple Touch ID / YubiKey thực tế.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Các bản vá mã nguồn contract trong `contracts/src/` đã hoàn tất và được kiểm chứng cục bộ qua Foundry. Không thực hiện broadcast hay deploy bytecode mới lên Avalanche Fuji testnet public vì chưa có lệnh phê duyệt chính thức từ Owner. Các địa chỉ contract hiện tại trên Fuji tiếp tục mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Kiểm thử Foundry cục bộ sử dụng `MockP256Precompile` (đóng vai trò golden-signature lookup oracle qua `vm.signP256`), không phải thực thi native precompile trên EVM mainnet/testnet.
