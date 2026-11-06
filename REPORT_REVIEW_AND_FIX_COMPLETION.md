# BÁO CÁO NGHIỆM THU ACCEPTANCE (BẢN FIX UI-02b, VER-02, INJ-01b, HYG-01, P1-A, P1-B, DEPLOY-READY)

**Thời điểm:** 2026-11-07 02:58 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Cam kết:** Chỉ 2 file trao đổi; contracts ở `contracts/`; không push `main`, không deploy public, không commit secret; chỉ simulation, không broadcast.

## 1. BẢNG ACCEPTANCE MỤC 4 (REVIEW_PROMPT_GPT.md 02:45)

| ID | Điều kiện đạt | Bằng chứng thực tế & Lệnh kiểm tra | Trạng thái |
|---|---|---|---|
| **UI-02b** | Pause thật → 403 ở agent + orchestrate; unpause chạy lại | `agent-lifecycle.test.ts` Reg 17: Owner ký challenge `PAUSE_S1` gọi `/api/system/pause`; `/api/agent/run` và `/api/tools/orchestrate` trả HTTP 403 (`System is paused`); unpause bằng challenge mới khôi phục 200. | **PASS** |
| **VER-02** | Một module verifier; thiếu inner prev_hash → FAIL cả hai | Gộp verifier vào `apps/web/lib/proof-verifier.ts`, `scripts/verify-proof.ts` import dùng chung. Kiểm tra nghiêm ngặt `parsed.prev_hash`. `agent-lifecycle.test.ts` Reg 18 & CLI `npm run verify-proof` đều PASS. | **PASS** |
| **INJ-01b** | Không bật theo từ khóa; chỉ env + non-production | Xóa mọi heuristic từ khóa trong `agent.ts`. Fixture chỉ bật khi `DEMO_ADVERSARIAL=1` và `NODE_ENV!=production`. `agent-lifecycle.test.ts` Reg 16 PASS. | **PASS** |
| **HYG-01** | tsbuildinfo không còn tracked | Đã xóa khỏi git cache: `git ls-files apps/web/tsconfig.tsbuildinfo` trả về rỗng. `.gitignore` đã có `*.tsbuildinfo`. | **PASS** |
| **P1-A** | Hàm + events + forge tests pass; backend dùng ví phiên ở S2 | `GuardedTreasury.sol` thêm `fundMissionWallet`, `sweepMissionWallet`, events `MissionFunded`, `MissionSwept`. `GuardedTreasury.t.sol` 6 test P1A PASS (fund 2 lần revert, vượt số dư revert, agent gọi revert, hết hạn revert, sweep PASS). `session-wallets.ts` cấp ví phiên riêng theo mission ở S2. Bảng tổn thất tối đa đã cập nhật trong `README.md`. | **PASS** |
| **P1-B** | Anchor + event + test; ERC-8004 module + test mock | `GuardedTreasury.sol` thêm `anchorMissionProof(missionId, headHash)`, event `MissionProofAnchored`, 2 test P1B PASS. Tạo `apps/web/lib/erc8004.ts` pin địa chỉ Fuji (`0x8004A818...`, `0x8004B663...`), test `tests/erc8004.test.ts` 3/3 PASS. | **PASS** |
| **DEPLOY-READY** | Script deploy chạy được simulation, chặn key Anvil, không broadcast | `contracts/script/Deploy.s.sol`: simulation tạo contract tại `0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3`; truyền key Anvil lập tức revert `KEY-02: INSECURE_ANVIL_KEY_PROHIBITED_ON_FUJI`. Không có cờ `--broadcast`. | **PASS** |

## 2. KẾT QUẢ KIỂM ĐỊNH TOÀN DIỆN

1. **Foundry Contracts Suite:** `30/30 tests PASS` (`contracts/test/GuardedTreasury.t.sol`: 22 gốc + 8 tests P1-A/P1-B).
2. **Foundry Deploy Simulation:** `forge script script/Deploy.s.sol` thành công (gas: 3,658,468, 0 tx broadcast).
3. **Vitest Full Suite:** `96/96 tests PASS` (8 test files: `unit-boundaries` 33, `p-series` 25, `agent-lifecycle` 18, `v-series` 10, `agent-planning` 4, `erc8004` 3, `e-series` 2, `handler-lifecycle` 1).
4. **Playwright E2E Suite:** `5/5 tests PASS` (`mission-control.spec.ts`).
5. **Standalone Verifier CLI:** `npm run verify-proof` exit 0 (self-test PASS).
6. **TypeScript Typecheck:** `npx tsc --noEmit --incremental false` exit 0 (0 errors).
7. **Bảo mật:** 0 keys/secrets commit; Anvil keys bị chặn trên mọi script deploy và config Fuji.
