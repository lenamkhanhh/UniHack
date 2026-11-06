# UniHack — review hiện tại và nhiệm vụ tiếp theo

Cập nhật: 2026-11-07, Asia/Saigon (review commit `a0c6b13`).
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack — nhánh `feat/s1-app`, HEAD `a0c6b13`.
Báo cáo đã đọc: REPORT_REVIEW_AND_FIX_COMPLETION.md (bản commit `a0c6b13`).
Kế hoạch: STRATEGY_MAX_SCORE.md.

## 1. Hai file trao đổi cố định

- REVIEW_PROMPT_GPT.md: reviewer cập nhật verdict và yêu cầu hiện hành.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: Gemini cập nhật kết quả/evidence (ngắn, theo bảng acceptance).

## 2. Verdict

### 2.1 Chấp nhận (reviewer đã kiểm lại)

| ID | Kết quả |
|---|---|
| SW-01 | Đạt. Bỏ fallback; HKDF-SHA256 từ `SESSION_WALLET_SEED` riêng; từ chối khi thiếu, ngắn hoặc trùng secret JWT. |
| ERC-01 | Đạt. ABI pin từ contract Fuji thật (`lib/abi/*.json`); `giveFeedback` 8 tham số, `agentId` uint256, có test selector. |
| SW-02 | Đạt. Sweep dùng `receiveWithAuthorization` (EIP-3009), không cần approve/gas của ví phiên. |
| SW-03 | Đạt. Fund bắt buộc có tool cap, amount ≤ cap. |
| ERC-02 | Đạt phần hash: MOCK trả `txHash: null`. (Xem WIRE-01 về trạng thái.) |
| Test | Reviewer chạy lại: **forge 31/31**, **vitest 101/101 (8 files)**, `tsc` exit 0. |

### 2.2 Chưa đạt

| ID | Mức | Vị trí | Vấn đề | Yêu cầu |
|---|---|---|---|---|
| **WIRE-01** | **Critical (trung thực)** | `app/api/missions/[slug]/activate/route.ts:52-80`, `complete/route.ts:54-75` | Ở S2, **mọi mode kể cả LIVE_FUJI**, activate ghi `funded: true` + audit `SESSION_WALLET_FUNDED`, complete ghi `anchored: true` + audit `PROOF_ANCHORED`, trong khi **không có giao dịch nào được gửi**. Audit ledger (thứ ta dùng làm "bằng chứng kiểm chứng được") đang chứa sự kiện chưa từng xảy ra. | Owner ký bằng MetaMask; backend không giữ owner key (spec 05). Luồng đúng: (1) backend trả **unsigned tx/calldata** cho `fundMissionWallet` / `anchorMissionProof`; (2) owner gửi tx từ ví; (3) client gửi `txHash` về; (4) backend đọc receipt trên Fuji, kiểm event (`MissionFunded` đúng missionId/wallet/amount; `MissionProofAnchored` đúng headHash), **rồi mới** ghi audit FUNDED/ANCHORED kèm tx hash. MOCK ghi trạng thái riêng (vd. `FUNDING_MOCK_NOT_SENT`), UI hiện đúng nhãn. Ở S2 LIVE, agent **không được chi** từ ví phiên khi funding chưa được xác nhận on-chain. Test cho từng nhánh, kể cả receipt sai event/sai amount → từ chối. |
| **FB-01** | High | `app/api/feedback/route.ts` | (1) Nhận **bất kỳ token** nào, kể cả spend token của agent; không kiểm `claims.type`, không có chữ ký owner, nhưng truyền `ownerConfirmed: true` cứng. Agent tự chấm điểm cho seller được. (2) `agentId` lấy từ body client, mặc định `1001`. (3) Không chống trùng: `source_key` có `Date.now()` nên gửi feedback lặp vô hạn cho cùng operation, thổi phồng reputation. (4) Ở LIVE trả `success: true`, `txHash: null`, ghi audit `ERC8004_FEEDBACK` dù không gửi tx. (5) Lỗi 500 trả `err.message`. | Chỉ owner (challenge EIP-191 như các route owner khác). `agentId` của seller lấy từ cấu hình đã đăng ký trong `toolCatalog`/env, không từ client. Unique 1 feedback / operation (constraint DB). LIVE: trả calldata để owner ký → verify receipt → mới ghi audit. MOCK: trạng thái `FEEDBACK_MOCK_NOT_SENT`. Lỗi chung. Test từng case. |
| DECK-07 | Medium | `artifacts/submission-s1/deck-outline-11-slides.md:36,58,65,71,95` | Outline nói như đã chạy thật: "Deployed & verified on Avalanche Fuji C-Chain" (dòng 95), "loss is mathematically bounded on-chain to $5.00" (36), "funded on-chain" (58, 65), "backend anchors…" (71; sai vì owner ký, không phải backend). | Câu nào phụ thuộc Fuji: thêm `PENDING_FUJI` hoặc viết ở thì "design", cho tới khi có tx. Sửa "backend anchors" thành "owner anchors (MetaMask)". |

## 3. Nhiệm vụ tiếp theo (đúng thứ tự)

1. **WIRE-01** (critical) → **FB-01** → DECK-07.
2. Rà toàn bộ code: grep mọi chỗ ghi audit/trạng thái on-chain (`FUNDED`, `ANCHORED`, `FEEDBACK`, `SETTLED` ở LIVE, `funded: true`, `anchored: true`, `success: true` đi kèm `txHash: null`). Mỗi chỗ phải gắn với receipt thật, hoặc ghi rõ trạng thái MOCK. Liệt kê kết quả rà soát trong report.
3. Sau đó **dừng thêm tính năng**. Toàn bộ backend đã sẵn sàng cho Fuji; việc còn lại phụ thuộc owner (ví test mới + `GEMINI_API_KEY`).

## 4. Acceptance lượt tới

| ID | Điều kiện đạt | Bằng chứng |
|---|---|---|
| WIRE-01 | Không ghi FUNDED/ANCHORED khi chưa có receipt hợp lệ; MOCK có trạng thái riêng; S2 LIVE chặn chi khi chưa fund | Test: receipt đúng / sai event / sai amount / MOCK |
| FB-01 | Owner-only, agentId từ cấu hình, 1 feedback/operation, LIVE verify receipt | Test từng case |
| DECK-07 | Không còn câu khẳng định đã chạy on-chain khi chưa có tx | Diff outline |
| AUDIT-SWEEP | Danh sách mọi chỗ ghi trạng thái on-chain và cách đã sửa | Bảng trong report |

## 5. Giới hạn thực thi

- **Không ghi vào audit, UI, report hay deck bất kỳ sự kiện/giao dịch/trạng thái nào mà hệ thống chưa thực sự tạo ra và kiểm chứng.**
- Backend không giữ owner key; mọi tx của owner do ví owner ký.
- Không broadcast lên Fuji khi owner chưa điền ví mới vào `.env` và chưa duyệt.
- Không dùng khóa Anvil/Hardhat trên mạng công khai; không đọc/in/commit key.
- Không push `main`, không deploy public, không nộp bài khi owner chưa duyệt.

## 6. Prompt cho Gemini

~~~text
Đọc REVIEW_PROMPT_GPT.md (review commit a0c6b13). Báo cáo ngắn vào REPORT_REVIEW_AND_FIX_COMPLETION.md.

Chấp nhận: SW-01, SW-02, SW-03, ERC-01, ERC-02 (hash). Reviewer chạy lại forge 31/31,
vitest 101/101, tsc ok.

Sửa theo thứ tự:
- WIRE-01 (critical): activate/complete ở S2 đang ghi FUNDED/ANCHORED vào audit ở mọi mode,
  kể cả LIVE, mà không có tx. Đổi sang: backend trả unsigned tx → owner ký MetaMask → client gửi
  txHash → backend verify receipt + event → mới ghi audit. MOCK có trạng thái riêng.
  S2 LIVE không cho chi khi chưa fund xong.
- FB-01: /api/feedback chỉ cho owner (challenge EIP-191), agentId từ cấu hình,
  1 feedback/operation, LIVE verify receipt, lỗi chung.
- DECK-07: outline không được nói đã deploy/fund/anchor khi chưa có tx; owner ký, không phải backend.
- AUDIT-SWEEP: rà mọi chỗ ghi trạng thái on-chain, liệt kê trong report.

Sau đó dừng thêm tính năng. Commit trên feat/s1-app, không push main, không deploy public,
không broadcast.
~~~

## 7. Nhật ký reviewer

Chỉ sửa REVIEW_PROMPT_GPT.md.
Lệnh đã chạy: đọc output watcher; `git log`, `git diff --stat ddd6d16 HEAD`; đọc `session-wallets.ts`, diff `GuardedTreasury.sol`, `app/api/feedback/route.ts`, nhánh LIVE của `erc8004.ts`, `activate/route.ts`, `complete/route.ts`; grep outline deck; `forge test` (31/31); `vitest run` (101/101); `tsc` (exit 0).
