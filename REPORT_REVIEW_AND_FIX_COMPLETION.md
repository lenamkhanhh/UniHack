# BÁO CÁO NGHIỆM THU ACCEPTANCE (BẢN FIX UI-01..05, P2-PRICE, KEY-02b, INJ-01)

**Thời điểm:** 2026-11-07 02:35 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Cam kết:** Chỉ 2 file trao đổi; contracts ở `contracts/`; không push `main`, không deploy public, không commit secret; chỉ dùng Fuji testnet.

## 1. BẢNG ACCEPTANCE MỤC 4 (REVIEW_PROMPT_GPT.md 02:15)

| ID | Điều kiện đạt | Bằng chứng thực tế & Lệnh kiểm tra | Trạng thái |
|---|---|---|---|
| **UI-01** | Verify thật; tamper → FAIL; 401 → UNVERIFIED; xóa toàn bộ hash/count gán cứng | `apps/web/lib/proof-verifier.ts` tính `keccak256` canonical JSON, kiểm sequential `prevHash` & checkpoint count/head. `demo/page.tsx` xác minh in-browser. Grep xác nhận không còn `0xe708441f`/`0x7e4b2d1c`. Playwright `mission-control.spec.ts` 3/3 cases PASS: Valid → VERIFIED; Tampered → FAIL; 401 → UNVERIFIED. Ảnh: `evidence/p2-mission-control-ui.png`. | **PASS** |
| **UI-02** | Pause gọi API `/api/system/pause`, agent run bị 403 khi paused | Nút Pause yêu cầu challenge `PAUSE_S1`, ký qua ví owner, POST `/api/system/pause`, refetch server policy. Khi pause, `/api/agent/run` trả HTTP 403 (`System is paused`). Playwright test UI-02 PASS. | **PASS** |
| **UI-03** | Queue lấy từ DB, approve qua API có chữ ký; S1 hiện trống | Stage S1 khóa hoàn toàn treasury (`STAGE_S1_NO_TREASURY`), UI hiển thị banner vô hiệu hóa S1 trung thực: "STAGE S1 INACTIVE — Treasury payouts disabled. Approval queue activates in Stage S2 with on-chain GuardedTreasury contract." 0 fake clickable items. | **PASS** |
| **UI-04/05** | Text theo mode; lý do Guarded lấy từ verdict thật | Header & badge ghi rõ: `Payment Mode: MOCK (Local Simulation)`. Thẻ Guarded render dynamic `verdict.rule` (`STAGE_S1_NO_TREASURY`) & `verdict.reason`. Ảnh: `evidence/p1-c-prompt-injection-defense.png`, `evidence/p2-mission-control-ui.png`. | **PASS** |
| **P2-PRICE** | BLOCK qua handler thanh toán thật | `verifyQuoteAgainstCatalog` được gọi trong `reserveOperation` (`payments.ts`) & `/api/agent/run`. Quote vượt giá bị chặn, ghi `BLOCKED` audit log dưới lock trong DB (`rule: 'PRICE_MISMATCH'`), ném error. Test `agent-lifecycle.test.ts` Reg 14 PASS. | **PASS** |
| **KEY-02b** | Route ngoài agent cũng fail ở LIVE khi config sai | `validateLiveFujiConfig()` được gọi trong `payments.ts` (mọi chi tiêu) và `/api/tools/orchestrate`. Test `agent-lifecycle.test.ts` Reg 15: gọi orchestrate ở LIVE_FUJI với ví Anvil lập tức ném `KEY-02`. | **PASS** |
| **INJ-01** | Không kích hoạt fixture qua từ khóa | Đã xóa kiểm tra từ khóa (`attack`, `injection`) trong `tools.ts`. Query nghiên cứu thật chạy bình thường. Fixture adversarial chỉ kích hoạt khi `demoAdversarial: true` hoặc env `DEMO_ADVERSARIAL=1` (kèm `fixture: true`). Test `agent-lifecycle.test.ts` Reg 16 PASS. | **PASS** |

## 2. KẾT QUẢ TEST & TYPECHECK TOÀN DIỆN

1. **Vitest Suite:** `91/91 tests PASS` (7 test files: `unit-boundaries` 33, `p-series` 25, `agent-lifecycle` 16, `v-series` 10, `agent-planning` 4, `e-series` 2, `handler-lifecycle` 1).
2. **Playwright E2E Suite:** `16/16 tests PASS` (`mission-control.spec.ts` 5, `agent-autonomous.spec.ts` 1, `mission-lifecycle.spec.ts` 2, `pending-and-publication.spec.ts` 7, `real-integration.spec.ts` 1).
3. **TypeScript Typecheck:** `npx tsc --noEmit --incremental false` exit 0 (0 errors).
4. **Evidence Screenshots:** Đã chụp lại và lưu vào `apps/web/evidence/p2-mission-control-ui.png` và `apps/web/evidence/p1-c-prompt-injection-defense.png`.
5. **Bảo mật:** 0 secrets / Anvil keys commit.
