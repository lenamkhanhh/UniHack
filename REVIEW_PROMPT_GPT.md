# UniHack — review hiện tại và nhiệm vụ tiếp theo

Cập nhật: 2026-11-07, Asia/Saigon (review commit `0614448`).
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack — nhánh `feat/s1-app`, HEAD `0614448`.
Báo cáo đã đọc: REPORT_REVIEW_AND_FIX_COMPLETION.md (bản commit `0614448`).
Kế hoạch: STRATEGY_MAX_SCORE.md.

## 1. Hai file trao đổi cố định

- REVIEW_PROMPT_GPT.md: reviewer cập nhật verdict và yêu cầu hiện hành.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: Gemini cập nhật kết quả/evidence (ngắn, theo bảng acceptance).

## 2. Verdict

### 2.1 Chấp nhận (reviewer đã kiểm lại)

| ID | Kết quả |
|---|---|
| **WIRE-01** | **Đạt.** S2: activate/complete trả `unsignedTx` cho owner ký; LIVE chỉ ghi audit FUNDED/ANCHORED sau khi `lib/fuji-receipts.ts` xác minh receipt (status success, `to` = treasury, event đúng missionId/wallet/amount/headHash). MOCK trả `*_MOCK_NOT_SENT`, không ghi audit. S2 LIVE chặn chi khi chưa fund. |
| **FB-01** | **Đạt.** Feedback chỉ owner (challenge `SUBMIT_FEEDBACK`); agentId từ cấu hình server; 1 feedback/operation (409); LIVE verify receipt; lỗi chung. |
| DECK-07 | Đạt. Outline ghi `PENDING_FUJI`, owner ký qua MetaMask. |
| AUDIT-SWEEP | Đạt (bảng trong report). |
| Test | Reviewer chạy lại: **forge 31/31**, **vitest 104/104 (8 files)**, `tsc` exit 0. |

### 2.2 Còn mở (nhỏ, sửa xong là dừng tính năng)

| ID | Mức | Vị trí | Vấn đề | Yêu cầu |
|---|---|---|---|---|
| RCPT-01 | Medium | `lib/fuji-receipts.ts` (3 hàm verify) | Decode event mà không kiểm `log.address`. Event `MissionFunded` / `MissionProofAnchored` / `NewFeedback` phải do đúng contract phát ra, không chỉ cùng tx. | Bỏ qua log nếu `log.address` ≠ treasury (hoặc ≠ ReputationRegistry proxy với feedback). Test: event đúng tên nhưng từ contract khác → invalid. |
| CFG-01 | Medium | `activate/route.ts:64`, `complete/route.ts` | `GUARDED_TREASURY_ADDRESS` mặc định `0x000…0`. Ở LIVE sẽ tạo unsigned tx gửi tới địa chỉ rỗng, và bỏ được kiểm `to` trong verifier. | Thêm vào `validateLiveFujiConfig()`: bắt buộc, khác zero address, là contract (có bytecode trên Fuji). Không có giá trị mặc định ở route. Test. |

## 3. Nhiệm vụ tiếp theo

1. RCPT-01, CFG-01 kèm test.
2. **Dừng phát triển tính năng.** Phần còn lại chờ owner:
   - Ví test mới (deployer/owner, agent, seller) có Fuji AVAX + USDC, điền vào `.env`.
   - `GEMINI_API_KEY` (LIVE_LLM).
   - Owner duyệt từng lệnh broadcast.
3. Viết sẵn **runbook Fuji** ngắn trong README: thứ tự lệnh deploy → verify Snowtrace → set env → chạy 1 mission S1 LIVE (2 settlement) → chuyển S2 (fund → agent → payout trong cap / vượt cap → complete/anchor → feedback). Mỗi bước ghi rõ ai ký (owner MetaMask hay backend) và tx nào cần lưu làm evidence. Không chạy.

## 4. Acceptance lượt tới

| ID | Điều kiện đạt | Bằng chứng |
|---|---|---|
| RCPT-01 | Log sai contract → invalid | Test |
| CFG-01 | LIVE thiếu/zero/không phải contract → fail | Test |
| RUNBOOK | Runbook Fuji đủ bước, chỉ rõ người ký và evidence | Đoạn README |

## 5. Giới hạn thực thi

- Không ghi vào audit, UI, report hay deck bất kỳ sự kiện/giao dịch/trạng thái nào mà hệ thống chưa thực sự tạo ra và kiểm chứng.
- Backend không giữ owner key; mọi tx của owner do ví owner ký.
- Không broadcast lên Fuji khi owner chưa điền ví mới vào `.env` và chưa duyệt.
- Không dùng khóa Anvil/Hardhat trên mạng công khai; không đọc/in/commit key.
- Không push `main`, không deploy public, không nộp bài khi owner chưa duyệt.

## 6. Prompt cho Gemini

~~~text
Đọc REVIEW_PROMPT_GPT.md (review commit 0614448). Báo cáo ngắn vào REPORT_REVIEW_AND_FIX_COMPLETION.md.

Chấp nhận: WIRE-01, FB-01, DECK-07, AUDIT-SWEEP. Reviewer chạy lại forge 31/31,
vitest 104/104, tsc ok.

Sửa nốt:
- RCPT-01: verifier receipt phải kiểm log.address đúng contract (treasury / ReputationRegistry).
- CFG-01: GUARDED_TREASURY_ADDRESS bắt buộc ở LIVE, khác zero, có bytecode; bỏ default 0x0.
Sau đó viết runbook Fuji trong README (mục 3), không chạy, không broadcast.
Rồi dừng thêm tính năng, chờ owner cấp ví mới + GEMINI_API_KEY.

Commit trên feat/s1-app, không push main, không deploy public.
~~~

## 7. Nhật ký reviewer

Chỉ sửa REVIEW_PROMPT_GPT.md.
Lệnh đã chạy: đọc output watcher; `git log`, `git diff --stat a0c6b13 HEAD`; đọc `lib/fuji-receipts.ts` (verify funding), `activate/route.ts` (unsigned tx + verify), grep `feedback/route.ts` (challenge, 409); `forge test` (31/31); `vitest run` (104/104); `tsc` (exit 0).
