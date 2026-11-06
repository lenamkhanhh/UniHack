# BÁO CÁO NGHIỆM THU ACCEPTANCE (BẢN FIX AG-05, AG-04, KEY-02, AG-07, P1-C, P2)

**Thời điểm:** 2026-11-07 02:08 (Asia/Saigon) | **Nhánh:** `feat/s1-app` | **HEAD:** Chuẩn bị commit Bước 1c & Bước 3/4  
**Cam kết:** Chỉ 2 file trao đổi; không push `main`, không deploy public, không nộp bài khi owner chưa duyệt.

## 1. BẢNG ACCEPTANCE MỤC 4 (REVIEW_PROMPT_GPT.md)

| ID | Điều kiện đạt | Bằng chứng thực tế & Lệnh kiểm tra | Trạng thái |
|---|---|---|---|
| **AG-05** | Payout không bao giờ vào đường tool; S2 PASS/QUEUE đúng nhánh; S1 BLOCK | `agent-lifecycle.test.ts` Reg 7 (S1 payout BLOCK `STAGE_S1_NO_TREASURY`), Reg 8 (S2 PASS -> `TreasuryRequest` state `CREATED`, PROPOSED audit, 0 tool ops), Reg 9 (S2 QUEUE -> `TreasuryRequest` state `QUEUED`, QUEUED audit, 0 tool ops). | **PASS** |
| **AG-04** | Override chỉ bật bằng env, nhãn CLIENT_OVERRIDE | `agent-lifecycle.test.ts` Reg 10: `overrideProposal` bị lờ đi khi không có env; chỉ nhận khi `ALLOW_AGENT_TEST_OVERRIDE=1` + `NODE_ENV!=production` với nhãn `plannerMode: 'CLIENT_OVERRIDE'`. | **PASS** |
| **KEY-02** | LIVE thiếu biến hoặc dùng địa chỉ Anvil → fail khi khởi động | `agent-lifecycle.test.ts` Reg 11: `validateLiveFujiConfig()` ném ngoại lệ khi `PAYMENT_MODE=LIVE_FUJI` thiếu biến hoặc trùng địa chỉ/khóa Anvil `0x7099...` / `0xac09...`. | **PASS** |
| **AG-07** | 500 không lộ chi tiết | `agent-lifecycle.test.ts` Reg 12: Route catch block trả JSON cố định `{ error: 'Internal agent execution error' }` (HTTP 500), không leak stack hay `err.message`. | **PASS** |
| **P1-C (local)** | Injection → BLOCK + audit; UI so sánh có nhãn MOCK | `agent-lifecycle.test.ts` Reg 13 (payload injection bị chặn 100%, 0 USDC thoát); E2E test `mission-control.spec.ts` so sánh Naive vs Guarded (có nhãn `MOCK (LOCAL SIMULATION)`); Ảnh: `evidence/p1-c-prompt-injection-defense.png`. | **PASS** |
| **P2-PRICE** | Quote vượt giá niêm yết → BLOCK | `agent-lifecycle.test.ts` Reg 14: `verifyQuoteAgainstCatalog` chặn `PRICE_MISMATCH` khi quote cao hơn giá catalog niêm yết và `OVER_PER_CALL_CAP`. | **PASS** |
| **P2-UI** | Mission Control đủ 5 phần | Thanh ngân sách (Spent/Reserved/Remaining) + Timeline bước/chi phí + Hàng chờ duyệt Treasury + Nút Verify proof trình duyệt + Nút Pause. E2E verified; Ảnh: `evidence/p2-mission-control-ui.png`. | **PASS** |

## 2. KẾT QUẢ KIỂM CHUẨN TỔNG THỂ

1. **Vitest Full Suite:** `89/89 tests PASS` (7 test files: unit-boundaries 33, p-series 25, agent-lifecycle 14, v-series 10, agent-planning 4, e-series 2, handler-lifecycle 1).
2. **Playwright E2E Suite:** `12/12 tests PASS` (11 ui-mocked + 1 real-integration DB-backed).
3. **Foundry Contracts Suite:** `22/22 tests PASS` (`test/GuardedTreasury.t.sol`).
4. **TypeScript Typecheck:** `tsc --noEmit` exit 0 (0 errors).
5. **Secret Scan:** 0 private keys / API keys commit.

*Ghi chú: Bước 2 (Fuji live deployment & LIVE_LLM) tiếp tục chờ owner cấp ví testnet mới và GEMINI_API_KEY trong .env.*
