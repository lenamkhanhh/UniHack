# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG 7, 8 & 9 - HOÀN TẤT A1..A9, DECK & P0 PACKAGING/SPIKE)

**Thời điểm:** 2026-11-13 13:30 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**HEAD Baseline Round 7:** `1764b5b` | **HEAD Round 7 Fix:** `63c1c8c`  
**HEAD Round 8 (Deck/Replay):** `8f9a528`  
**HEAD Round 9 Commits:** `87dd0c4` (P0-1), `c5e2756` (P0-2), `d9e7ef3` (R9-F6..F9), `d0c2415` (P1-B Spike & CI)

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU CÁC VÒNG

| Nhóm | Mức | Trạng thái | Commit | File chính | Test & Bằng chứng nghiệm thu đã kiểm |
|---|---|---|---|---|---|
| **A1** | **P1** | **ACCEPTED** | `15d8ee5` | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol` | Snapshot Merkle root tại `proposeWithProof`; `approve` và `execute` từ chối nếu root khác snapshot. 5 unit tests hồi quy (`test_A1_*`) pass; invariant suite (512 runs, 32,768 calls, 0 reverts) pass. Địa chỉ Fuji lịch sử là `OLD_DEPLOYMENT`. |
| **A2** | **P1** | **RESOLVED** | `4955a99`<br>`f644dec` | `apps/web/e2e/passkey.spec.ts`<br>`apps/web/lib/webauthn-p256.ts` | Sửa dynamic origin trong test RP ID; adapter P-256 xác minh ECDSA độc lập; UI phân biệt simulation vs confirmed card. 7/7 Playwright tests pass; 24/24 WebAuthn tests pass. Nhãn `LOCAL_BROWSER_CRYPTO_BOUNDARY`. |
| **A3** | **P1** | **ACCEPTED** | `1981c21` | `contracts/src/PasskeyMissionAuthority.sol` | Passkey governance và recovery (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). `MockP256Precompile` trong Foundry là golden oracle. 32/32 tests pass. |
| **A4** | **P1** | **ACCEPTED** | `63c1c8c` | `apps/web/lib/validator-job.ts`<br>`apps/web/tests/m7-validator-automation.test.ts` | Xóa fallback `writeContract` (fail-closed); tuần tự hóa nonce bằng `pg_advisory_xact_lock`; bảo mật raw bytes không lộ qua API. 41 passed / 0 failed / 1 skipped trong `m7-validator-automation.test.ts`. |
| **A5** | **P1** | **RESOLVED** | `3fa5ff9` | `apps/web/prisma/migrations/` | Clean staging build proof: `npm run build` thành công (33/33 routes); 7 migrations qua `prisma migrate deploy`; `tsc --noEmit` 0 errors. |
| **A6** | **P2** | **RESOLVED** | `4955a99` | `eval/agentdojo/` | Fingerprint môi trường suite; counters thu thập chính xác từ subprocess; isolated legacy cache. 14/14 Python tests pass. |
| **A7** | **P2** | **ACCEPTED** | `fea5f20`<br>`dde044e` | `packages/guard/` | Canonical mission ID/slug; đối chiếu Merkle root từ payees; ưu tiên hard BLOCK trước soft QUEUE. 19/19 SDK tests pass. |
| **A8** | **P2** | **ACCEPTED** | `467e251`<br>`937f41a`<br>`b7da608` | `apps/web/lib/bounty.ts`<br>`apps/web/tests/bounty.test.ts` | PostgreSQL reservation rate limiting: global advisory lock, khấu trừ độc lập với kết quả lease; fail-closed; trusted ingress header. 18/18 tests pass. |
| **A9** | **P2** | **RESOLVED** | `63c1c8c` | `REPORT_REVIEW_AND_FIX_COMPLETION.md` | Báo cáo đầy đủ bằng chứng Round 7; xác nhận không push public, không broadcast Fuji, không commit secret; kê khai ranh giới `NOT_RUN`. |
| **Round 8** | **P2** | **RESOLVED** | `8f9a528` | `artifacts/submission-s1/deck-v2/`<br>`VIDEO_SCRIPT.md` | Bổ sung số liệu replay AgentDojo ngoại tuyến (120/128 blocked, 8 misses tại user_task_15, false positive 3/16, Fuji fork 169/169 agree & 150/150 revert); sửa theme `MissionPay Console` (R8-F1); xuất PPTX, PDF, PNG Slide 9. |
| **P0-1** | **P0** | **ACCEPTED** | `87dd0c4` | `README.md`<br>`docs/review-history/` | Tái cấu trúc README "chấm trong 60s": 1 câu mô tả, 3 link live/video/snowtrace, bảng bằng chứng rubric, mục giới hạn đã biết. Chuyển toàn bộ báo cáo lịch sử vào `docs/review-history/`. |
| **P0-2** | **P0** | **RESOLVED** | `c5e2756`<br>`d9e7ef3`<br>`d0c2415` | `.github/workflows/ci.yml`<br>`scripts/verify-all.cjs`<br>`eval/agentdojo/requirements.txt` | Tạo GitHub Actions CI (Foundry, Guard, Web tsc + vitest, AgentDojo benchmark); tạo kịch bản `npm run verify:all` hợp nhất; pin Foundry stable (1.9.0); bổ sung `requirements.txt`; bổ sung `prisma:generate` cho fresh clone. Toàn bộ 6 suites pass. |
| **P0-2b** | **P0** | **RESOLVED** | Working Tree | Báo cáo mục 6.4 | Quét toàn bộ lịch sử commit tìm secret: không rò rỉ API key; Anvil test key công khai trong mock; phát hiện private key validator ở reflog `da53b69` (đã amend ở `cc58ea3`) -> có hướng dẫn xoay key và prune reflog trước khi public. |
| **P1-B (Step 0)** | **P1** | **RESOLVED** | `d0c2415` | `docs/m9-self-relay-spike.md` | Nghiên cứu kiến trúc tự relay Avalanche ICM Warp Dispatch -> Fuji qua Ava Labs Glacier API `signatureAggregator` và EIP-2930 access-list delivery; phác thảo viem helper; kết luận **CONDITIONAL GO** và danh mục cấp tiền faucet. |

---

## 2. KẾT QUẢ KIỂM THỬ TOÀN DIỆN (FULL TEST RUN EVIDENCE)

### 2.1 Smart Contracts (`contracts/`)
- **Lệnh chạy:** `forge test --summary`
- **Kết quả:** **111 Passed / 0 Failed / 0 Skipped** (Toàn bộ 6 suites, 6.65s - 15.5s):
  - `GuardedTreasuryTest`: **43 passed**
  - `PasskeyGovernanceTest`: **32 passed**
  - `PasskeyMissionAuthorityTest`: **16 passed**
  - `MissionCrossChainICMTest`: **12 passed**
  - `ValidationRegistryTest`: **7 passed**
  - `GuardedTreasuryInvariantTest`: **1 passed** (6 stateful invariants, **512 runs / 32,768 calls / 0 reverts**)

### 2.2 Guard SDK (`packages/guard/`)
- **Lệnh chạy:** `npm --workspace=@missionpay/guard run test`
- **Kết quả:** **19 Passed / 0 Failed / 0 Skipped** (4.6s, 2 test files: `guard.test.ts`, `parity.test.ts`).

### 2.3 Web Application (`apps/web/`)
- **Lệnh tạo Prisma Client:** `npm --workspace=apps/web run prisma:generate` (96ms)
- **TypeScript Compiler Check:** `npx.cmd tsc --noEmit -p apps/web/tsconfig.json` (10.1s, **Exit code 0**, 0 errors)
- **Vitest Full Suite:** `npm --workspace=apps/web run test` (164.9s)
- **Kết quả:** **32 test files passed (317 passed / 0 failed / 1 skipped)**:
  - `tests/m7-validator-automation.test.ts`: **41 passed / 1 skipped** (M7-A4-31..36)
  - `tests/bounty.test.ts`: **18 passed**
  - `tests/passkey-relay.test.ts`: **11 passed**
  - Toàn bộ các suite API routes, crypto, validation, parser: **247 passed**

### 2.4 Browser E2E Playwright Suite (`apps/web/e2e/passkey.spec.ts`)
- **Lệnh chạy:** `npx.cmd playwright test e2e/passkey.spec.ts`
- **Kết quả:** **7 Passed / 0 Failed** (1.5m trên headless Chromium).

### 2.5 AgentDojo Benchmark (`eval/agentdojo/`)
- **Lệnh chạy:** `python eval/agentdojo/test_provguard_pairs.py`
- **Kết quả:** **14 Passed / 0 Failed / 0 Skipped** (46.6s, không cần LLM API key).

### 2.6 Kiểm chứng Hợp nhất (`npm run verify:all`)
- **Lệnh chạy:** `npm run verify:all`
- **Kết quả:** **ALL 6 SUITES PASSED!** (Forge 111, Guard 19, Prisma generate OK, Web tsc OK, Vitest 317, AgentDojo pairs 14).

---

## 3. CHI TIẾT SỬA LỖI ROUND 7 (A4 DEFECTS RESOLVED)

1. **Xóa bỏ hoàn toàn fallback `writeContract`:**
   - Trong `apps/web/lib/validator-job.ts`, đã loại bỏ hoàn toàn các dòng lệnh gọi `(broadcastClient as any).writeContract(...)`. Nếu thiếu `sendRawTransaction`, worker fail-closed với trạng thái `RESPONSE_PENDING`, 0 giao dịch được gửi và `responseTxHash` được bảo toàn nguyên vẹn (M7-A4-34).
2. **Tuần tự hóa cấp phát nonce bằng `pg_advisory_xact_lock`:**
   - Thực thi trong một `prisma.$transaction` duy nhất với SQL `SELECT pg_advisory_xact_lock(...)`. Nonce được ghi nhận bền vững vào `frozenContext` trước khi commit. RPC lỗi fail-closed, không bao giờ fallback về 0 (M7-A4-35).
3. **Bảo mật tuyệt đối chuỗi bytes ký `rawTransaction`:**
   - Toàn bộ API routes chỉ trả về allowlist DTO; `rawTransaction` và `frozenContext` không bao giờ rò rỉ ra response JSON hay log (M7-A4-36).

---

## 4. NGHIỆM THU ROUND 8 (P2): PITCH DECK & VIDEO SCRIPT REPLAY NUMBERS

1. **Số liệu Replay AgentDojo ngoại tuyến:** Bổ sung vào Slide 9 (`build_deck.js`) với nhãn chuẩn: `AgentDojo banking, model-free replay` (120/128 injection blocked, 8 misses user_task_15, false positive 3/16, Fuji fork 169/169 agree & 150/150 revert). Không dùng số live incomplete; không dùng từ ngữ cấm.
2. **Lời thoại Video (`VIDEO_SCRIPT.md`):** Cập nhật placeholder M4 với nhãn replay ngoại tuyến.
3. **Sửa Theme R8-F1 & Xuất Artifacts:** Loại bỏ silent-skip trong `build_deck.js` (throw error nếu thiếu `PPTX_SKILL`). Xuất PPTX, PDF, và PNG kiểm tra trực quan `slide-9-benchmark.png` (theme `MissionPay Console` chuẩn màu `E84142`, `10B981`, `F59E0B`, không tràn dòng).

---

## 5. KÊ KHAI RANH GIỚI KỸ THUẬT & EXTERNAL NOT_RUN

1. **Thiết bị xác thực sinh trắc học vật lý (Physical Hardware Biometric):** Đánh dấu **NOT_RUN**. Kiểm thử passkey thực hiện qua WebAuthn virtual authenticator; chưa thử nghiệm trên Touch ID / YubiKey vật lý.
2. **Triển khai Smart Contract lên Avalanche Fuji Testnet:** Đánh dấu **NOT_RUN**. Bản vá trong `contracts/src/` được kiểm chứng qua 111 Foundry tests cục bộ. Chưa broadcast bytecode mới lên Fuji; địa chỉ hiện tại mang nhãn `OLD_DEPLOYMENT`.
3. **Precompile RIP-7212 Native On-Chain:** Đánh dấu **NOT_RUN**. Sử dụng `MockP256Precompile` cục bộ qua `vm.signP256`.

---

## 6. NGHIỆM THU ROUND 9 (P0 PACKAGING, CI, FRESH-CLONE, SECRET SCAN & ICM SPIKE)

### 6.1 Tổng hợp Đóng gói & Phản hồi Reviewer (R9-F1..F10)
- **R9-F1 (README badge URLs):** Đã sửa đường dẫn CI badge thành repo chính xác `lenamkhanhh/UniHack/actions/workflows/ci.yml` và chuyển các link badge khác sang relative repo path (commit `c5e2756`).
- **R9-F2 (Avalanche row contracts):** Đã sửa thành `MissionBudgetHub.sol` và `MissionSpendGateway.sol` với chú giải rõ: *(local mock tests; not yet live)* (commit `c5e2756`).
- **R9-F3 (Static badges):** Đã gỡ bỏ badge đếm tĩnh dễ bị lệch; chuyển sang hiển thị bảng text rõ ràng trong README (commit `c5e2756`).
- **R9-F4 (Pitch deck slide count):** Xác nhận chính xác slide count của Pitch Deck v2 là **14 slides** (14 hàm `addSlide` trong `build_deck.js`, đã cập nhật dòng Pitch trong `README.md:21`).
- **R9-F5 (Bytecode Fuji vs contracts/src):** Đã phân tích chi tiết tại mục 6.3; xác nhận 0 claim nào trong README/Deck/Q&A phụ thuộc vào code chưa deploy.
- **R9-F6 (Hiệu chuẩn Invariant Oracle):** Khi seed `0x86d1bd1bafcb21a9ec74a309ea3524f8c454595dd3f9cca512c7a59fe83abf4c` chạy, chuỗi hành động xảy ra: `actionSetMissionPayeeRoot` hạ root về 0 -> `actionPropose` đề xuất cho payee hợp lệ trong allowlist -> `actionAttemptPolicyChange` thu hồi quyền allowlist của payee -> `actionExecute` rút tiền. Do allowlist bị đổi SAU khi propose/execute, assertion cũ dựa trên `recipientAllowlist(to)` hiện hành bị sai lệch. Khắc phục chuẩn xác (tương tự M9-F14): Handler ghi nhận `allowlistedAtPayout` ngay tại thời điểm gọi, và invariant assert trên giá trị đã ghi nhận này. Invariant suite 6/6 green tuyệt đối (commit `d9e7ef3`).
- **R9-F7 (Submodules):** Reviewer Claude đã **RÚT LẠI (WITHDRAWN)** yêu cầu vì `contracts/` độc lập hoàn toàn, không import forge-std hay OpenZeppelin bên ngoài.
- **R9-F8 (Foundry Pin):** Đã pin action `foundry-rs/foundry-toolset@v1` với `version: 'stable'` (commit `d9e7ef3`).
- **R9-F9 (Benchmark requirements):** Đã tạo `eval/agentdojo/requirements.txt` với version cố định (`agentdojo==0.1.18`, `google-genai==1.50.0`, `python-dotenv==1.0.1`) và bổ sung bước pip install vào CI workflow (commit `d9e7ef3`).
- **R9-F10 (Fresh-Clone Proof):** Đã thực thi clone mới độc lập và kiểm chứng trọn vẹn toàn bộ 6 bước (xem chi tiết mục 6.2).
- **R9-F11 (Reconciliation Ví Agent):** Đối soát xác nhận ví Agent chuẩn mực trong toàn bộ hệ thống là `0x374b8A126FDb9e5deEc8307da385076155Af3D72`, được dẫn xuất trực tiếp tại runtime từ `process.env.AGENT_PRIVATE_KEY` (`privateKeyToAccount(process.env.AGENT_PRIVATE_KEY).address`). Địa chỉ `0x84fEE0...F217` xuất hiện trong bản nháp spike ban đầu là một placeholder mẫu chưa qua đối soát; đã được loại bỏ và đồng bộ hoàn toàn. Toàn bộ scripts hiện tại đều dẫn xuất ví động từ env key, không hardcode.
- **Glacier Aggregator No-Key Verification:** Claude và probe kiểm thử trực tiếp xác nhận endpoint `POST https://glacier-api.avax.network/v1/signatureAggregator/fuji/aggregateSignatures` tổng hợp chữ ký BLS cho Warp message Dispatch thành công (HTTP 201, 916 bytes) mà **không cần bất kỳ API key nào**. Ghi nhận giảm tải cho Owner (không cần tạo Glacier key).

### 6.2 Bằng chứng Kiểm thử Fresh-Clone Độc lập (R9-F10 Verification Proof)
Đã thực hiện sao chép một bản clone hoàn toàn mới vào thư mục tạm `C:\Users\HP\AppData\Local\Temp\unihack-fresh-clone` từ local repo và chạy từng bước kiểm thử:
1. **Contracts (`cd contracts && forge test --summary`):**
   - Hoàn thành trong **6.65s**.
   - **111 passed, 0 failed, 0 skipped**.
   - 6 invariants chạy 512 runs, 32,768 calls, 0 reverts. Không cần bất kỳ submodule hay network download nào.
2. **Cài đặt thư viện gốc (`npm ci`):**
   - Thêm 347 packages sạch sẽ trong **35s**.
3. **Guard SDK build & test (`npm --workspace=@missionpay/guard test`):**
   - **19 passed, 0 failed** trong **4.6s**.
4. **Tạo Prisma Client (`npm --workspace=apps/web run prisma:generate`):**
   - Sinh `@prisma/client` trong **96ms** (đã được tích hợp vào `ci.yml` và `verify-all.cjs`).
5. **Kiểm tra kiểu TypeScript (`npx tsc --noEmit -p apps/web/tsconfig.json`):**
   - Hoàn tất trong **10.1s**, **Exit code 0**, 0 lỗi.
6. **Web Vitest Suite (`npm --workspace=apps/web run test`):**
   - **32 test files passed (317 passed / 0 failed / 1 skipped)** trong 164.9s.
7. **AgentDojo ProvGuard Pair Suite (`python eval/agentdojo/test_provguard_pairs.py`):**
   - **14 passed, 0 failed, 0 skipped** trong 46.6s.
8. **Kịch bản Hợp nhất (`npm run verify:all`):**
   - **ALL 6 SUITES PASSED!**
- **Yêu cầu môi trường & Biến `.env`:**
  - `DATABASE_URL=postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test` (dùng daemon embedded postgres nội bộ có sẵn trong repo tại `.cache/test-postgres`).
  - Toàn bộ 6 suites đều chạy nội bộ, **không cần bất kỳ API key bên ngoài hay bí mật nào**.

### 6.3 Đối chiếu Bytecode Triển khai Fuji vs Mã nguồn `contracts/src/` (R9-F5)
Địa chỉ contract triển khai trên Fuji Testnet: `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`.

| Tiêu chí | Bytecode trên Avalanche Fuji | Mã nguồn hiện tại `contracts/src/GuardedTreasury.sol` | Đánh giá & Ảnh hưởng Claim |
|---|---|---|---|
| **A1 Merkle Root Snapshotting** | Chỉ kiểm tra `verifyPayeeProof` tại thời điểm `proposeWithProof`. Không lưu `proposalRoots[proposalId]`; `approve` và `execute` không kiểm tra biến động của root sau đề xuất. | Lưu `proposalRoots[proposalId] = currentRoot` tại đề xuất. Bắt buộc `require(currentRoot == proposalRoots[proposalId], "ProposalPayeePolicyChanged")` tại cả `approve` và `execute`. | **Không ảnh hưởng claim**: README (Known Limitations mục 4) và Deck ghi nhận rõ bytecode Fuji là Phase 1 deployment; tính năng snapshotting A1 được kiểm chứng qua 111 Foundry tests và 6 invariants. |
| **A3 Passkey Governance & Recovery** | Không có contract `PasskeyMissionAuthority.sol` được triển khai trên Fuji. | Đầy đủ logic governance và recovery qua chữ ký passkey (`emergencyWithdraw`, `withdrawTokens`, `sweepMissionWalletWithAuthorization`). | **Không ảnh hưởng claim**: Tính năng governance A3 được công bố minh bạch là kiểm thử cục bộ trong Foundry với 32 tests; không tuyên bố là đã deploy live trên Fuji. |
| **Chế độ Allowlist Fallback (Twin Treasury)** | Khi root == 0, fallback kiểm tra `recipientAllowlist(to)`. Hoạt động tương đồng. | Hoạt động hoàn toàn tương đồng khi root == 0. | **Trực tiếp phục vụ kịch bản Twin Treasury**: Cả 2 phiên bản đều cho phép thực thi kịch bản so sánh 2 giao dịch thật (allowlist vs mission) mà không cần deploy lại contract. |
| **Khẳng định tính trung thực:** | Không có bất kỳ tuyên bố nào trong README, Pitch Deck v2, Video Script hay Judge Q&A khẳng định A1 và A3 đã hoạt động on-chain trên Fuji bytecode lịch sử. |

### 6.4 Kết quả Quét Bí mật (Secret Scan) trong Lịch sử Git (P0-2b)
Đã thực hiện quét tự động qua toàn bộ các commit và đối tượng git với các mẫu regex đặc thù:
- `AIza[0-9A-Za-z-_]{35}`: Toàn bộ các kết quả khớp chỉ là các đoạn code kiểm tra tiền tố cú pháp (`process.env.LLM_API_KEY?.startsWith('AIza')`) trong `apps/web/lib/agent.ts`, `apps/web/lib/tools.ts`, `apps/web/lib/bounty.ts`. Không có API key Gemini/Google nào bị đưa vào commit.
- `AQ\.[0-9A-Za-z-_]{40,}`: Chuỗi khớp nằm trong khối byte nhị phân của ảnh chụp màn hình `artifacts/submission-s1/deck-shots/fuji-verify-anchor.png`. Không phải Anthropic API key.
- `0x[a-fA-F0-9]{64}`: Các chuỗi hex 64 ký tự là khóa công khai Anvil test key #0 mặc định (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`) trong các file mock test.
- **Khóa Riêng tư Validator M7-F1 (Quan trọng):**
  - Tại commit `da53b69` (ngày 10/11/2026), khóa riêng tư của ví validator Fuji từng bị commit nhầm vào `tests/m7-validator-automation.test.ts`.
  - Tại commit `cc58ea3`, commit này đã được amend để chuyển sang đọc từ biến môi trường `process.env.VALIDATOR_PRIVATE_KEY`.
  - Mặc dù commit `da53b69` không nằm trên nhánh tuyến tính HEAD của `feat/s1-app`, hash này vẫn còn tồn tại trong git reflog (`.git/logs/HEAD`) và dangling git objects của repo nội bộ.
  - **Hành động bắt buộc cho Owner trước khi Public Repo:**
    1. Xoay khóa (rotate key): Chuyển sang một địa chỉ ví validator mới trên Avalanche Fuji testnet và hủy sử dụng ví cũ.
    2. Dọn dẹp reflog: Chạy `git reflog expire --expire=now --all && git prune` để xóa vĩnh viễn các commit object mồ côi trước khi push ra remote công khai.

### 6.5 Kết quả Spike Tự Relay ICM Dispatch -> Fuji (P1-B Step 0)
- **Tài liệu hoàn chỉnh:** Đã hoàn thành và commit tại `docs/m9-self-relay-spike.md` (commit `d0c2415`).
- **Nguồn tài liệu chính thức:** Ava Labs Avalanche Inter-Chain Messaging (ICM), TeleporterMessenger, Avalanche Warp Precompile (`0x0200000000000000000000000000000000000005`), Glacier API Specification.
- **Endpoint chính xác:**
  - `POST https://glacier-api.avax.network/v1/signatureAggregator/testnet/aggregateSignatures`
  - Body: `{ message: unsignedWarpMsgBytes, quorumPercentage: 67, signingSubnetId: dispatchSubnetId }`
- **Cơ chế nạp Access List trên Fuji:**
  - Giao dịch EIP-2930 gọi `receiveCrossChainMessage(messageIndex, relayerRewardAddress)` trên Fuji TeleporterMessenger.
  - Access list chỉ định địa chỉ `0x0200000000000000000000000000000000000005` và các storage key đóng gói chữ ký BLS tổng hợp và byte thông điệp.
- **Kết luận:** **CONDITIONAL GO** (Khả thi trong thời gian 1-2 ngày mà không phụ thuộc vào relayer công khai của bên thứ ba).
- **Yêu cầu Owner chuẩn bị (Funding Prerequisites):**
  1. Nhận token testnet `DISPATCH` miễn phí từ Builder Hub Faucet cho 2 ví (Owner: `0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c` và Agent: `0x374b8A126FDb9e5deEc8307da385076155Af3D72`, dẫn xuất động từ env).
  2. **Glacier API Key: KHÔNG CẦN THIẾT** (Aggregator hoạt động hoàn toàn miễn phí không cần key).
  3. Ví relayer trên Fuji (`0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA`) đã có sẵn `0.02 AVAX`, đủ cho khoảng 20 lượt delivery.
