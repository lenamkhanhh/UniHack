# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG 5 - HOÀN TẤT TRIỆT ĐỂ A1..A9)

**Thời điểm:** 2026-11-11 08:00 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Đánh Giá Trước Khi Fix (Reviewer Baseline Round 5):** `6aa2edf`  
**HEAD Mã Nguồn Đã Sửa & Kiểm Thử Toàn Diện:** `c2383af` (`feat/s1-app`)

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `proposeWithProof`; `approve` và `execute` từ chối nếu root khác snapshot (`require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")`). Handler ghi `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. Địa chỉ Fuji lịch sử là `OLD_DEPLOYMENT`. |
| **A2** | **P1** | **RESOLVED** | `4955a99`<br>`f644dec` | `apps/web/e2e/passkey.spec.ts`<br>`apps/web/app/missions/new/page.tsx`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/lib/webauthn-p256.ts`<br>`apps/web/tests/passkey-relay.test.ts` | Sửa dynamic origin trong test RP ID (`currentOrigin` từ request/URL, giữ nguyên verify RP mismatch không gọi `credentials.get`). Adapter mật mã P-256 độc lập xác minh ECDSA trên `authenticatorData \|\| sha256(clientDataJSON)`, từ chối sai key, sai signature, tráo mission/nonce/cap. UI phân biệt rõ ràng simulation và confirmed card. 7/7 Playwright browser tests pass trên port 3138; 24/24 WebAuthn tests pass; 11/11 relay unit tests pass. Nhãn `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware ghi `NOT_RUN`. |
| **A3** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `1981c21` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Quyền governance và recovery qua passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). Ghi nhận giới hạn kỹ thuật: `MockP256Precompile` trong Foundry là golden-signature oracle dùng `vm.signP256`; test negative wrong-private-key và mutated signature pass. 32/32 tests pass. |
| **A4** | **P1** | **RESOLVED** *(Round 5 5-Gap Fix)* | `c2383af` | `apps/web/lib/validator-job.ts`<br>`apps/web/lib/auth.ts`<br>`apps/web/lib/challenges.ts`<br>`apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/app/verify/[missionId]/page.tsx`<br>`apps/web/tests/m7-validator-automation.test.ts`<br>`apps/web/e2e/passkey.spec.ts` | **Khắc phục trọn vẹn 5 lỗ hổng mục 257–270 Round 5:**<br>1. **Action-bound owner auth:** Thêm action `RECONCILE_VALIDATION_REQUEST` vào challenge engine; kiểm tra ràng buộc slug, txHash, chainId 43113, registry address; consume challenge một lần; token Bearer bắt buộc đúng scope mission (`claims.missionSlug === slug`).<br>2. **Strict chain response verification:** Xóa bỏ hoàn toàn fallback điểm số (`score ?? 100`, `verified-full`). Đọc trực tiếp `getValidationStatus` tuple (validator, agentId, score 0..100, responseHash), đối chiếu matching `ValidationResponse` event từ log khi biết `responseTxHash`. Status RPC lỗi hoặc tuple sai -> pending/unavailable, không bao giờ tự nhận CONFIRMED.<br>3. **Live lease fencing & Deterministic submission:** `workerLeaseUntil: { gte: now }` bảo vệ tất cả database mutation; gia hạn lease trước các tác vụ IO/RPC dài (`renewJobLease`). Chuẩn bị response transaction payload/hash trước khi broadcast; crash/timeout chỉ đối soát transaction đã chuẩn bị, `writeContract` gọi tối đa 1 lần duy nhất.<br>4. **Truly frozen evidence:** Frozen context lưu trữ đầy đủ `bundle`, `identities` (registry, validator, agent, owner, chainId) và `evidence` (evaluation payload, response JSON string, responseHash). Phát hiện bất kỳ thay đổi nào giữa mission hiện hành và context đã đóng băng -> ném lỗi `STALE_CONTEXT`. Không tái quét lại log khi context đã đánh giá.<br>5. **Wallet pending flow:** Trang `/verify/[missionId]` kiểm tra và chuyển chain Avalanche Fuji (`0xa869`), fail closed nếu sai chain. Khóa `localStorage` lưu pending tx gắn chặt với `43113_${to}_${requestHash}_${missionId}_${owner}`. Polling có giới hạn (bounded 10s); yêu cầu challenge server và ký `personal_sign` xác thực khi reconcile. Playwright browser test chứng minh: reload -> reconcile thành công, `sendTransaction` gọi đúng 1 lần duy nhất; sai chain gửi 0 transaction.<br>**Kết quả:** 37 passed / 1 skipped (38 tests) trong `m7-validator-automation.test.ts`; 7 passed trong `passkey.spec.ts`. |
| **A5** | **P1** | **RESOLVED** | `3fa5ff9` | `apps/web/prisma/migrations/`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Clean staging build proof: Root `npm run build` hoàn tất thành công (Exit code 0, 33/33 routes). Database sạch áp dụng trọn vẹn toàn bộ 7 migration qua `prisma migrate deploy` (không dùng `db push`). `tsc --noEmit -p apps/web/tsconfig.json` không có lỗi. |
| **A6** | **P2** | **RESOLVED** | `4955a99` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Fingerprint môi trường suite và tool schemas thực tế; thu thập chính xác counters từ tiến trình con worker (`api_calls`, `api_errors`, `trace`); timeout/error không bịa đặt số đếm; chế độ legacy cache hoàn toàn cô lập phục vụ báo cáo lịch sử ngoại tuyến. 14/14 Python tests pass. |
| **A7** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `fea5f20`<br>`dde044e` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts` | Đối chiếu canonical mission ID/slug; đối chiếu Merkle root từ payees; ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `467e251`<br>`937f41a`<br>`b7da608` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110120000_bounty_quota_reservation/`<br>`apps/web/tests/bounty.test.ts` | Atomic PostgreSQL reservation rate limiting: global advisory lock trước IP lock, tuần tự hóa nghiêm ngặt tại ngưỡng 299; bảo lưu khấu trừ hạn ngạch độc lập với kết quả/lease; DB down fail-closed; reverse proxy `TRUSTED_INGRESS` chống giả mạo header; offline simulation stub. 18/18 tests pass. |
| **A9** | **P2** | **RESOLVED** | `c2383af` | `REPORT_REVIEW_AND_FIX_COMPLETION.md`<br>`DEPLOY_CHECKLIST.md` | Cập nhật đầy đủ bằng chứng kiểm thử Round 5 (37 unit tests M7, 7 browser Playwright tests); mô tả chi tiết 5 điểm vá A4; xác nhận không push public, không broadcast Fuji testnet, không commit secret; kê khai ranh giới `NOT_RUN` rõ ràng. |

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
- **Lệnh chạy:** `vitest run --root apps/web tests/m7-validator-automation.test.ts`
- **Kết quả:** **37 Passed / 0 Failed / 1 Skipped** (38 total tests trong suite M7).
  - M7-A4-28: Action-bound owner challenge (`RECONCILE_VALIDATION_REQUEST`) rejects unrelated action, expired nonce, or unauthenticated caller [PASS]
  - M7-A4-29: Token mission scope check rejects spend token for a different mission slug [PASS]
  - M7-A4-30: Strict chain response verification: RPC throw or malformed getValidationStatus tuple refuses CONFIRMED [PASS]
  - M7-A4-31: Live lease fencing and crash recovery: writeContract called at most once across timeout and restart [PASS]
  - M7-A4-32: Frozen evidence context: mission scope or configured identity mutation fails with STALE_CONTEXT [PASS]
- **Lệnh chạy:** `vitest run --root apps/web tests/bounty.test.ts tests/passkey-relay.test.ts`
- **Kết quả:** **29 Passed / 0 Failed** (18 bounty tests, 11 passkey-relay tests).
- **TypeScript Compiler Check:** `tsc --noEmit -p apps/web/tsconfig.json`
- **Kết quả:** **Exit code 0** (0 errors).

### 2.4 Browser E2E Playwright Suite (`apps/web/e2e/passkey.spec.ts`)
- **Lệnh chạy:** `$env:PLAYWRIGHT_TEST_PORT="3138"; npx.cmd playwright test e2e/passkey.spec.ts --project=ui-mocked`
- **Kết quả:** **7 Passed / 0 Failed** (1.3m trên port 3138 độc lập):
  1. `User cancellation does NOT succeed and displays error deterministically (A2-R6)` [PASS]
  2. `Virtual Authenticator registers P-256 passkey, extracts coordinates, and authorizes two sequential missions via real cryptographic boundary adapter (A2-R4, A2-R6)` [PASS]
  3. `UI refuses known RP ID / origin mismatch before credentials.get (A2-R2)` [PASS]
  4. `Adversarial negatives against cryptographic adapter: wrong signature, wrong key, wrong nonce, altered mission (A2-R4, A2-R6)` [PASS]
  5. `UI State Boundaries: Simulation success renders simulation badge and does NOT render confirmed card (A2-R3)` [PASS]
  6. `UI State Boundaries: Missing receipt fields or RPC failure does NOT show confirmed success card or message (A2-R3)` [PASS]
  7. `A4-Gap-5: Wallet pending flow on verify page: unmined -> reload -> mined reconciliation (sendTransaction count 1); wrong/unknown chain sends 0` [PASS]

### 2.5 AgentDojo Benchmark (`eval/agentdojo/`)
- **Lệnh chạy:** `eval\agentdojo\.venv\Scripts\python.exe -m unittest eval/agentdojo/test_provguard_pairs.py`
- **Kết quả:** **14 Passed / 0 Failed / 0 Skipped** (21.0s).

---

## 3. CHI TIẾT 5 ĐIỂM VÁ A4 (ROUND 5 CORRECTIONS)

1. **Owner signature action binding:**
   - Định nghĩa hành động `RECONCILE_VALIDATION_REQUEST` trong `apps/web/lib/auth.ts` và `apps/web/lib/challenges.ts`.
   - Payload payloadHash được băm và kiểm tra chặt chẽ: `slug`, `txHash`, `chainId: 43113`, `registryAddress`.
   - Challenge được tiêu thụ (consumed) nguyên tử qua database, chống tấn công replay.
   - Endpoint `POST /api/verify/[missionId]` xác minh token Bearer bắt buộc có `claims.type === 'read' && claims.missionSlug === mission.slug && claims.owner === mission.ownerAddress`.

2. **Xóa bỏ hoàn toàn false completion & Strict chain response verification:**
   - Trong `apps/web/lib/validator-job.ts`, loại bỏ toàn bộ các fallback `score ?? 100`, `verified-full` hoặc `0x0` dummy response hash.
   - Hàm tập trung `verifyStrictChainResponse` đọc tuple từ `getValidationStatus` trên chain: yêu cầu khớp chính xác `validatorAddress`, `agentId`, điểm số nguyên tử trong khoảng 0..100.
   - Khi có `responseTxHash`, hàm đọc transaction receipt và phân tích event `ValidationResponse` phát ra từ registry, so khớp `requestHash` và `responseHash`.
   - Khi RPC đọc chain thất bại hoặc trả tuple không hợp lệ -> trạng thái giữ nguyên `RESPONSE_PENDING` hoặc báo lỗi `CHAIN_READ_ERROR`, không bao giờ chuyển sang `RESPONSE_CONFIRMED`.

3. **Live lease fencing & Deterministic submission:**
   - `updateJobWithLease` yêu cầu điều kiện kép: `leaseToken: token` VÀ `workerLeaseUntil: { gte: now }`.
   - Hàm `renewJobLease` được gọi định kỳ trước và trong các tác vụ kiểm tra hợp đồng / tính toán snapshot.
   - Worker chuẩn bị sẵn dữ liệu transaction trước khi gửi: nếu worker gặp sự cố mạng hoặc crash ngay sau khi gửi `writeContract`, khi khởi động lại worker sẽ đối soát mã `responseTxHash` đã ghi nhận thay vì ký và gửi một transaction mới. `writeContract` được đảm bảo thực thi tối đa 1 lần.

4. **Truly frozen evidence & identities:**
   - Frozen context `FrozenValidationContext` lưu giữ: (a) Bundle chuẩn hóa; (b) Toàn bộ identities cấu hình (`registryAddress`, `validatorAddress`, `agentId`, `ownerAddress`, `chainId`); (c) Bằng chứng snapshot (`evaluatedAt`, `responseJsonString`, `responseHash`).
   - Trước khi worker tiến hành chuyển trạng thái, đối chiếu context đã đóng băng với bản ghi mission và cấu hình hệ thống hiện tại. Nếu phát hiện sai khác (ví dụ `payeeRoot` hoặc `auditHeadHash` bị thay đổi, hoặc cấu hình registry/validator bị tráo) -> lập tức chuyển job thành `STALE_CONTEXT` và từ chối phát sóng on-chain.
   - Bỏ điều kiện ép đánh giá lại khi có `publicClient` tùy chỉnh, tái sử dụng chính xác `responseJsonString` và `responseHash` nguyên bản.

5. **Wallet pending flow trên giao diện `/verify/[missionId]`:**
   - Giao diện người dùng kiểm tra chain mạng Avalanche Fuji (`0xa869`). Nếu sai mạng, tự động gọi `wallet_switchEthereumChain`; nếu lỗi hoặc từ chối, dừng ngay lập tức (fail-closed) và không cho gửi transaction.
   - Trạng thái giao dịch chờ được lưu vào `localStorage` với khóa phân định đầy đủ `pending_validation_tx_43113_${to}_${requestHash}_${missionId}_${owner}`.
   - Giao diện thực hiện bounded polling (10 lần, 1s/lần) chờ receipt được đào (mined). Nếu chưa đào kịp hoặc trang bị reload, giao diện đọc lại pending tx từ `localStorage` và chỉ thực hiện đối soát khi đã có receipt, không bao giờ gọi lại `eth_sendTransaction` lần thứ hai.
   - Khi receipt được xác nhận, giao diện xin server challenge cho action `RECONCILE_VALIDATION_REQUEST`, ký qua `personal_sign` của ví và gửi kèm Bearer token để xác thực đối soát.

---

## 4. KÊ KHAI RANH GIỚI KỸ THUẬT & EXTERNAL NOT_RUN

1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey được thực hiện qua WebAuthn virtual authenticator và adapter ECDSA P-256 độc lập; chưa thử nghiệm trên thiết bị phần cứng Apple Touch ID / YubiKey thực tế.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Các bản vá mã nguồn contract trong `contracts/src/` đã hoàn tất và được kiểm chứng cục bộ qua Foundry. Không thực hiện broadcast hay deploy bytecode mới lên Avalanche Fuji testnet public vì chưa có lệnh phê duyệt chính thức từ Owner. Các địa chỉ contract hiện tại trên Fuji tiếp tục mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Kiểm thử Foundry cục bộ sử dụng `MockP256Precompile` (đóng vai trò golden-signature lookup oracle qua `vm.signP256`), không phải thực thi native precompile trên EVM mainnet/testnet.
