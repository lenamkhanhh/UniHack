# BÁO CÁO NGHIỆM THU ACCEPTANCE (SW-01..03, ERC-01..02, P1-WIRE, README & DECK)

**Thời điểm:** 2026-11-07 03:20 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Cam kết:** Chỉ 2 file trao đổi; contracts ở `contracts/`; không push `main`, không deploy public, không commit secret; chỉ Fuji simulation, không broadcast.

## 1. BẢNG ACCEPTANCE MỤC 4 (REVIEW_PROMPT_GPT.md 03:10)

| ID | Điều kiện đạt | Bằng chứng thực tế & Lệnh kiểm tra | Trạng thái |
|---|---|---|---|
| **SW-01** | Không fallback; HKDF + seed riêng ≥32 ký tự; LIVE từ chối cấu hình yếu/trùng | `session-wallets.ts` dùng HKDF-SHA256 (`salt=DEPLOYMENT_ID`, `info=session-wallet:v1:${slug}`) từ `SESSION_WALLET_SEED` riêng biệt; xóa bỏ toàn bộ fallback key cứng. `config.ts` (`validateLiveFujiConfig`) chặn nếu thiếu seed, seed < 32 ký tự, trùng JWT secret hoặc trùng placeholder dev. `tests/erc8004.test.ts` (tests 1–4) PASS. | **PASS** |
| **ERC-01** | ABI pin từ contract thật; selector khớp; agentId uint256; client = owner | Pinned verified implementation ABIs từ Fuji vào `apps/web/lib/abi/erc8004-reputation.json` và `erc8004-identity.json`. `lib/erc8004.ts` gọi `giveFeedback` đủ 8 tham số, `agentId` kiểu `uint256` (`bigint`), caller là mission owner. `tests/erc8004.test.ts` (test 5) verify selector `0x87a17bc1` PASS. | **PASS** |
| **SW-02** | Sweep không cần approve/gas của ví phiên; test không prank approve | `GuardedTreasury.sol` thêm `sweepMissionWalletWithAuthorization` dùng EIP-3009 `receiveWithAuthorization`. Owner gọi contract và trả gas; ví phiên chỉ ký EIP-712 off-chain (gasless, 0 AVAX). `contracts/test/GuardedTreasury.t.sol` test `test_SW02_sweep_mission_wallet_gasless_authorization` không dùng prank/approve; `forge test` 31/31 PASS. | **PASS** |
| **ERC-02 / SW-03** | MOCK trả txHash null trung thực; fund bắt buộc có tool cap rõ | `erc8004.ts` và API routes trả `txHash: null` ở chế độ MOCK (không sinh fake hash). `fundMissionWallet` trong `GuardedTreasury.sol` bắt buộc `missionToolCap[missionId] > 0` và `amount <= toolCap`, bỏ hoàn toàn fallback `perTxCap`. `test_SW03_fund_without_toolcap_or_over_toolcap_reverts` PASS. | **PASS** |
| **P1-WIRE** | Lifecycle S2 nối fund, anchor, feedback; MOCK ghi rõ mode | `activate/route.ts` nối cấp ví phiên + audit `SESSION_WALLET_FUNDED`. `complete/route.ts` nối anchor proof + audit `PROOF_ANCHORED`. Tạo `api/feedback/route.ts` kiểm tra `SETTLED` và gọi `submitErc8004Feedback` + audit `ERC8004_FEEDBACK`. `tests/agent-lifecycle.test.ts` Reg 19 test toàn bộ luồng E2E PASS. | **PASS** |
| **README / DECK** | README cập nhật env/tổn thất; outline deck 11 slide không tx giả | `README.md` cập nhật danh sách env LIVE bắt buộc, bảng tổn thất tối đa SW-01/P1-A, câu định vị MissionPay. Tạo `artifacts/submission-s1/deck-outline-11-slides.md` (11 slide theo STRATEGY §7, sửa DECK-01..06, số liệu 27.5k endpoint, ma trận đối thủ, ô tx ghi rõ `PENDING_FUJI`). | **PASS** |

## 2. KẾT QUẢ KIỂM ĐỊNH TOÀN DIỆN

1. **Foundry Contracts Suite:** `31/31 tests PASS` (`contracts/test/GuardedTreasury.t.sol`: 22 gốc + 7 P1 + 2 SW-02/SW-03).
2. **Vitest Full Suite:** `101/101 tests PASS` across 8 files (`unit-boundaries` 33, `p-series` 25, `agent-lifecycle` 19, `v-series` 10, `erc8004` 7, `agent-planning` 4, `e-series` 2, `handler-lifecycle` 1).
3. **TypeScript Typecheck:** `npx tsc --noEmit --incremental false` exit 0 (0 errors).
4. **Bảo mật & Giới hạn:** Không commit private key/seed, không fake transaction hash, không deploy public, không broadcast lên mạng công khai.
