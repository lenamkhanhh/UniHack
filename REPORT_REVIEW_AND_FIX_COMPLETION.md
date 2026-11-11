# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG 6 - HOÀN TẤT TRIỆT ĐỂ A1..A9)

**Thời điểm:** 2026-11-11 08:45 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Đánh Giá Trước Khi Fix (Reviewer Baseline Round 6):** `4c4295c`  
**HEAD Mã Nguồn Đã Sửa & Kiểm Thử Toàn Diện (Round 6 Fix):** `019025c` (`feat/s1-app`)

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU A1..A9

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol`<br>`contracts/test/invariant/Handler.sol`<br>`contracts/test/invariant/GuardedTreasury.invariant.t.sol` | Snapshot Merkle root tại `proposeWithProof`; `approve` và `execute` từ chối nếu root khác snapshot (`require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")`). Handler ghi `rootAtPayout` tại thời điểm execute thật. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. Địa chỉ Fuji lịch sử là `OLD_DEPLOYMENT`. |
| **A2** | **P1** | **RESOLVED** | `4955a99`<br>`f644dec` | `apps/web/e2e/passkey.spec.ts`<br>`apps/web/app/missions/new/page.tsx`<br>`apps/web/app/api/passkey/relay/route.ts`<br>`apps/web/lib/webauthn-p256.ts`<br>`apps/web/tests/passkey-relay.test.ts` | Sửa dynamic origin trong test RP ID (`currentOrigin` từ request/URL, giữ nguyên verify RP mismatch không gọi `credentials.get`). Adapter mật mã P-256 độc lập xác minh ECDSA trên `authenticatorData \|\| sha256(clientDataJSON)`, từ chối sai key, sai signature, tráo mission/nonce/cap. UI phân biệt rõ ràng simulation và confirmed card. 7/7 Playwright browser tests pass trên port 3138; 24/24 WebAuthn tests pass; 11/11 relay unit tests pass. Nhãn `LOCAL_BROWSER_CRYPTO_BOUNDARY`, hardware ghi `NOT_RUN`. |
| **A3** | **P1** | **ACCEPTED** *(Reviewer đã accept)* | `1981c21` | `contracts/src/PasskeyMissionAuthority.sol`<br>`contracts/test/PasskeyMissionAuthority.t.sol`<br>`contracts/test/PasskeyGovernance.t.sol` | Quyền governance và recovery qua passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). Ghi nhận giới hạn kỹ thuật: `MockP256Precompile` trong Foundry là golden-signature oracle dùng `vm.signP256`; test negative wrong-private-key và mutated signature pass. 32/32 tests pass. |
| **A4** | **P1** | **RESOLVED** *(Round 6: Real Signed Raw Tx & Strict Hash Validation)* | `019025c` | `apps/web/lib/validator-job.ts`<br>`apps/web/tests/m7-validator-automation.test.ts` | **Khắc phục triệt để 2 khiếm khuyết Round 6:**<br>1. **Real Locally Signed Raw EVM Transaction & Deterministic Recovery:** Xóa bỏ hoàn toàn descriptive placeholder string `preparedTxHash` và override giả lập. Ký trực tiếp raw transaction EVM bằng `signingAccount.signTransaction` (với đầy đủ `nonce`, `gas`, `fees`, `data`, `to`, `chainId: 43113`), tính mã băm chuẩn xác qua `keccak256(rawTransaction)`. Tuần tự hóa cấp phát nonce của ví validator bằng PostgreSQL transaction advisory lock (`pg_advisory_lock(hashtext('validator_nonce:<address>'))`). Lưu nguyên tử raw bytes và txHash vào `context.preparedResponse` trước khi broadcast. Phát sóng qua raw transport `sendRawTransaction`; khi restart/crash chỉ đối soát và rebroadcast chính xác raw bytes đã lưu, không ký tx mới.<br>2. **Strict Response Hash & Honest External Response Distinction:** Loại bỏ toàn bộ điều kiện fail-open (`!respHash \|\| respHash === '0x0' \|\| !evHash \|\| evHash === respHash`). Xác thực nghiêm ngặt tuple types: address EVM hợp lệ, `agentId >= 0n`, `lastUpdate > 0n`, integer score 0..100, exact bytes32 hash (từ chối `'0x0'`, zero hash, malformed strings). Yêu cầu `log.address == registryAddress`, exact event responseHash và tag. Nếu tx do chính job gửi (`responseTxHash`), tuple và event responseHash phải khớp tuyệt đối frozen evidence. Nếu on-chain đã có response độc lập với score/hash khác, ghi nhận rõ ràng `isExternalResponse: true` hiển thị bằng chứng chain mà không mạo nhận nó chứng minh cho evidence của job này.<br>**Kết quả:** 38 passed / 1 skipped (39 tests) trong `m7-validator-automation.test.ts`; 7 passed trong `passkey.spec.ts`. |
| **A5** | **P1** | **RESOLVED** | `3fa5ff9` | `apps/web/prisma/migrations/`<br>`package.json`<br>`DEPLOY_CHECKLIST.md` | Clean staging build proof: Root `npm run build` hoàn tất thành công (Exit code 0, 33/33 routes). Database sạch áp dụng trọn vẹn toàn bộ 7 migration qua `prisma migrate deploy` (không dùng `db push`). `tsc --noEmit -p apps/web/tsconfig.json` không có lỗi. |
| **A6** | **P2** | **RESOLVED** | `4955a99` | `eval/agentdojo/run_benchmark.py`<br>`eval/agentdojo/test_provguard_pairs.py` | Fingerprint môi trường suite và tool schemas thực tế; thu thập chính xác counters từ tiến trình con worker (`api_calls`, `api_errors`, `trace`); timeout/error không bịa đặt số đếm; chế độ legacy cache hoàn toàn cô lập phục vụ báo cáo lịch sử ngoại tuyến. 14/14 Python tests pass. |
| **A7** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `fea5f20`<br>`dde044e` | `packages/guard/src/validator.ts`<br>`packages/guard/src/merkle.ts`<br>`packages/guard/src/guard.ts`<br>`packages/guard/tests/guard.test.ts`<br>`packages/guard/tests/parity.test.ts` | Đối chiếu canonical mission ID/slug; đối chiếu Merkle root từ payees; ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **ACCEPTED** *(Reviewer đã accept)* | `467e251`<br>`937f41a`<br>`b7da608` | `apps/web/lib/bounty.ts`<br>`apps/web/app/api/bounty/attempt/route.ts`<br>`apps/web/prisma/schema.prisma`<br>`apps/web/prisma/migrations/20261110120000_bounty_quota_reservation/`<br>`apps/web/tests/bounty.test.ts` | Atomic PostgreSQL reservation rate limiting: global advisory lock trước IP lock, tuần tự hóa nghiêm ngặt tại ngưỡng 299; bảo lưu khấu trừ hạn ngạch độc lập với kết quả/lease; DB down fail-closed; reverse proxy `TRUSTED_INGRESS` chống giả mạo header; offline simulation stub. 18/18 tests pass. |
| **A9** | **P2** | **RESOLVED** | `019025c` | `REPORT_REVIEW_AND_FIX_COMPLETION.md`<br>`DEPLOY_CHECKLIST.md` | Cập nhật đầy đủ bằng chứng kiểm thử Round 6 (38 unit tests M7, 7 browser Playwright tests); mô tả chi tiết giải pháp ký raw transaction thật, serialized nonce, strict hash validation; xác nhận không push public, không broadcast Fuji testnet, không commit secret; kê khai ranh giới `NOT_RUN` rõ ràng. |

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
- **Lệnh chạy:** `vitest run --root apps/web tests/m7-validator-automation.test.ts`
- **Kết quả:** **38 Passed / 0 Failed / 1 Skipped** (39 total tests trong suite M7).
  - M7-A4-28: Action-bound owner challenge (`RECONCILE_VALIDATION_REQUEST`) rejects unrelated action, expired nonce, or unauthenticated caller [PASS]
  - M7-A4-29: Token mission scope check rejects spend token for a different mission slug [PASS]
  - M7-A4-30: Live lease fencing: worker 1 cannot broadcast or update after lease expires and is reclaimed by worker 2 [PASS]
  - M7-A4-31: Locally prepared and signed raw EVM transaction: hash matches `keccak256(rawTx)`, same bytes rebroadcast on crash, single tx identity [PASS]
  - M7-A4-32: Truly frozen evidence & identities: rejects mutated identities with STALE_CONTEXT and reuses frozen evidence hash without re-scan [PASS]
  - M7-A4-33: Strict chain response verification: rejects malformed tuple hashes (`0x0`, zero bytes32), absent event emitter (`log.address != registryAddress`), different event hash/tag, and distinguishes external response [PASS]
- **Lệnh chạy:** `vitest run --root apps/web tests/bounty.test.ts tests/passkey-relay.test.ts`
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

## 3. CHI TIẾT SỬA LỖI ROUND 6 (A4 DEFECTS RESOLVED)

1. **Ký raw transaction thật và cấp phát nonce tuần tự qua PostgreSQL Advisory Lock:**
   - Xóa bỏ hoàn toàn descriptive placeholder string `preparedTxHash` và option override.
   - Thêm `allocateValidatorNonce(publicClient, validatorAddress)`: Sử dụng PostgreSQL transaction advisory lock (`pg_advisory_lock(hashtext('validator_nonce:<address>'))`) để tuần tự hóa việc lấy nonce giữa các concurrent worker; tính nonce kế tiếp dựa trên on-chain transaction count và các job active trong DB.
   - Ký trực tiếp raw transaction EVM bằng `signingAccount.signTransaction` với đầy đủ tham số (`to`, `data`, `value: 0n`, `nonce`, `gas`, `maxFeePerGas`, `maxPriorityFeePerGas`, `chainId: 43113`).
   - Tính toán deterministic transaction hash từ chính chuỗi bytes đã ký: `realTxHash = keccak256(rawTransaction)`.
   - Lưu trữ nguyên tử cấu trúc `PreparedResponseRecord` (chứa `txHash`, `rawTransaction`, `nonce`, `to`, `data`, `score`, `tag`) vào DB trong `context.preparedResponse` với trạng thái `RESPONSE_PENDING` TRƯỚC KHI phát sóng ra mạng.
   - Phát sóng qua raw transport `broadcastClient.sendRawTransaction({ serializedTransaction: rawTransaction })`.
   - Khi restart hoặc phục hồi sau crash: Kiểm tra trạng thái chain; nếu chưa được mined, rebroadcast CHÍNH XÁC raw bytes đã lưu, tuyệt đối không ký transaction mới, bảo đảm transaction identity đơn nhất (single transaction identity).

2. **Xác thực hash nghiêm ngặt & Phân định trung thực external response:**
   - Xóa bỏ toàn bộ điều kiện lỏng lẻo (`!respHash || respHash === '0x0' || !evHash || evHash === respHash`).
   - Kiểm tra định dạng `isBytes32Hex`: Chuỗi hex đúng 32 bytes (`/^0x[0-9a-fA-F]{64}$/`) và khác zero hash `0x000...000`.
   - Xác thực kiểu dữ liệu tuple `getValidationStatus`: `validatorAddress` hợp lệ, `agentId` là bigint không âm, `lastUpdate > 0n`, điểm số `chainScore` là số nguyên trong khoảng 0..100.
   - Xác minh event `ValidationResponse` trong logs: Bắt buộc `log.address == registryAddress`, decode event và so khớp chính xác validator, agentId, requestHash, score, responseHash và tag.
   - Ràng buộc response do chính job này gửi (`responseTxHash`): tuple responseHash và event responseHash bắt buộc phải khớp tuyệt đối frozen evidence responseHash. Nếu không khớp -> trả về `FAILED`.
   - Phân định response độc lập đã tồn tại trên chain (`responseTxHash` rỗng): Nếu on-chain có response hợp lệ nhưng điểm/hash khác, ghi nhận `isExternalResponse: true`, `isConfirmed: false`, `status: 'UNAVAILABLE'` để hiển thị bằng chứng chain mà không mạo nhận nó chứng minh cho evidence cục bộ của job này.
   - Khi RPC đọc status hợp đồng thất bại -> trả về `UNAVAILABLE` (fail closed), không bao giờ tự nhận CONFIRMED.

---

## 4. KÊ KHAI RANH GIỚI KỸ THUẬT & EXTERNAL NOT_RUN

1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey được thực hiện qua WebAuthn virtual authenticator và adapter ECDSA P-256 độc lập; chưa thử nghiệm trên thiết bị phần cứng Apple Touch ID / YubiKey thực tế.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Các bản vá mã nguồn contract trong `contracts/src/` đã hoàn tất và được kiểm chứng cục bộ qua Foundry. Không thực hiện broadcast hay deploy bytecode mới lên Avalanche Fuji testnet public vì chưa có lệnh phê duyệt chính thức từ Owner. Các địa chỉ contract hiện tại trên Fuji tiếp tục mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Kiểm thử Foundry cục bộ sử dụng `MockP256Precompile` (đóng vai trò golden-signature lookup oracle qua `vm.signP256`), không phải thực thi native precompile trên EVM mainnet/testnet.
