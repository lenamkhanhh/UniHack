# BÁO CÁO NGHIỆM THU ACCEPTANCE (WIRE-01, FB-01, DECK-07, AUDIT-SWEEP)

**Thời điểm:** 2026-11-07 05:46 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Cam kết:** Chỉ 2 file trao đổi; contracts ở `contracts/`; không push `main`, không deploy public, không commit secret; chỉ Fuji simulation, không broadcast.

## 1. BẢNG ACCEPTANCE MỤC 4 (REVIEW_PROMPT_GPT.md)

| ID | Điều kiện đạt | Bằng chứng thực tế & Lệnh kiểm tra | Trạng thái |
|---|---|---|---|
| **WIRE-01** | Không ghi FUNDED/ANCHORED khi chưa có receipt; MOCK có trạng thái riêng; S2 LIVE chặn chi khi chưa fund | `activate` và `complete` trả `unsignedTx` calldata; ở MOCK trả `FUNDING_MOCK_NOT_SENT` / `ANCHOR_MOCK_NOT_SENT` và không ghi audit. Ở LIVE, `verifyFundingReceiptOnFuji` / `verifyAnchorReceiptOnFuji` kiểm tra `MissionFunded` / `MissionProofAnchored` (status, to, missionId, wallet, amount, headHash), đúng mới ghi audit. S2 LIVE chặn chi (`SESSION_WALLET_NOT_FUNDED_ON_CHAIN` -> 403) nếu chưa có funding xác nhận on-chain. `tests/erc8004.test.ts` & `tests/agent-lifecycle.test.ts` Reg 19 PASS. | **PASS** |
| **FB-01** | Owner-only qua EIP-191 challenge; agentId từ cấu hình; 1 feedback/op; LIVE verify receipt; lỗi chung | `/api/feedback` đổi sang challenge EIP-191 `SUBMIT_FEEDBACK` (chặn spend token của agent). `sellerAgentId` lấy từ `toolCatalog` (`getErc8004AgentIdForTool`), bỏ `agentId` từ client. Chống trùng bằng `source_key: erc8004:feedback:${operationId}` (trả 409 nếu lặp). MOCK trả `FEEDBACK_MOCK_NOT_SENT` (không ghi audit). LIVE verify receipt bằng `verifyFeedbackReceiptOnFuji`. Lỗi 500 trả "Internal server error". `tests/erc8004.test.ts` & Reg 19 PASS. | **PASS** |
| **DECK-07** | Không khẳng định đã chạy on-chain khi chưa có tx; sửa owner anchors | Đã sửa `artifacts/submission-s1/deck-outline-11-slides.md`: dòng 36 (bổ sung PENDING_FUJI), 58 (designed to be funded on-chain, PENDING_FUJI), 65 (Owner signs and submits, PENDING_FUJI), 71 (owner anchors via MetaMask, PENDING_FUJI), 95 (Foundry verified 31/31, deployment & Snowtrace PENDING_FUJI). | **PASS** |
| **AUDIT-SWEEP** | Rà soát toàn bộ nơi ghi audit / trạng thái on-chain | Đã kiểm tra toàn bộ 6 vị trí (bảng chi tiết mục 2 dưới đây). Mọi sự kiện đều gắn với receipt thật hoặc gắn nhãn MOCK trung thực, tuyệt đối không có tx hash giả. | **PASS** |

## 2. BẢNG KẾT QUẢ RÀ SOÁT ON-CHAIN STATUS (AUDIT-SWEEP)

| File / Vị trí | Sự kiện / Trạng thái | Xử lý MOCK Mode | Xử lý LIVE Mode |
|---|---|---|---|
| `activate/route.ts` | `SESSION_WALLET_FUNDED` | Trả `FUNDING_MOCK_NOT_SENT`, `funded: false`, `unsignedTx`, **không ghi audit**. | Bắt buộc `fundingTxHash`, verify `MissionFunded` event trên Fuji; hợp lệ mới ghi audit với txHash thật. |
| `complete/route.ts` | `PROOF_ANCHORED` | Trả `ANCHOR_MOCK_NOT_SENT`, `anchored: false`, `unsignedTx`, **không ghi audit**. | Bắt buộc `anchorTxHash`, verify `MissionProofAnchored` event trên Fuji; hợp lệ mới ghi audit với txHash thật. |
| `feedback/route.ts` | `ERC8004_FEEDBACK` | Trả `FEEDBACK_MOCK_NOT_SENT`, `txHash: null`, `unsignedTx`, **không ghi audit**. | Bắt buộc `txHash`, verify trên ReputationRegistry Fuji qua `verifyFeedbackReceiptOnFuji`; hợp lệ mới ghi audit. |
| `payments.ts` (reserve / sign) | Chi tiêu ví phiên S2 | Cho phép kiểm tra budget local / mock. | Kiểm tra audit ledger: nếu chưa có `SESSION_WALLET_FUNDED` với txHash thật -> ném `SESSION_WALLET_NOT_FUNDED_ON_CHAIN` (HTTP 403). |
| `reconcile.ts` | `TOOL_PAID` / `SETTLED` | Gắn nhãn `txHash: mock:${opId}`, blockNumber/Hash = null. | Đọc receipt từ C-Chain qua `productionChainReader`, verify authorization/transfer log index trước khi SETTLED. |
| `erc8004.ts` | `submitErc8004Feedback` | Trả `txHash: null`, `simulated: true`, trả calldata. | Trả calldata cho owner ký MetaMask; không tạo hash giả. |

## 3. KẾT QUẢ KIỂM ĐỊNH TOÀN DIỆN

1. **Foundry Contracts Suite:** `31/31 tests PASS` (`contracts/test/GuardedTreasury.t.sol`).
2. **Vitest Full Suite:** `104/104 tests PASS` across 8 files (`unit-boundaries` 33, `p-series` 25, `agent-lifecycle` 19, `erc8004` 10, `v-series` 10, `agent-planning` 4, `e-series` 2, `handler-lifecycle` 1).
3. **TypeScript Typecheck:** `npx tsc --noEmit --incremental false` exit 0 (0 errors).
4. **Bảo mật & Giới hạn:** Không commit private key, không fake tx hash, không deploy public, không broadcast lên mạng công khai.
