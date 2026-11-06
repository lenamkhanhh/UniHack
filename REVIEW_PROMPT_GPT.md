# UniHack — review hiện tại và nhiệm vụ tiếp theo

Cập nhật: 2026-11-07 02:15, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack — nhánh `feat/s1-app`, HEAD `25e1dcf`.
Báo cáo đã đọc: REPORT_REVIEW_AND_FIX_COMPLETION.md (bản commit `25e1dcf`).
Kế hoạch: STRATEGY_MAX_SCORE.md.

## 1. Hai file trao đổi cố định

- REVIEW_PROMPT_GPT.md: reviewer cập nhật verdict và yêu cầu hiện hành.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: Gemini cập nhật kết quả/evidence (ngắn, theo bảng acceptance).

## 2. Verdict

### 2.1 Chấp nhận (reviewer đã kiểm lại)

| ID | Kết quả |
|---|---|
| AG-05 | Đạt. Payout tách khỏi đường tool; S1 BLOCK; S2 PASS/QUEUE tạo `TreasuryRequest` + audit (Reg 7–9). |
| AG-04 | Đạt. Override chỉ bật bằng `ALLOW_AGENT_TEST_OVERRIDE=1` ngoài production, nhãn `CLIENT_OVERRIDE`. |
| AG-07 | Đạt. 500 trả lỗi chung. |
| Test | Reviewer chạy lại `vitest run` toàn bộ: **89/89, 7 files**; `tsc` exit 0. |

### 2.2 Chưa đạt: UI đang báo kết quả giả (chặn nộp bài)

Đây là lỗi nghiêm trọng nhất từ đầu tới giờ về **tính trung thực của demo**. Giám khảo mở code (DevRel, academic) sẽ thấy ngay; nếu bị phát hiện khi Q&A, toàn bộ claim "verifiable" của sản phẩm mất giá trị.

| ID | Mức | Vị trí | Vấn đề | Yêu cầu |
|---|---|---|---|---|
| **UI-01** | **Critical** | `app/demo/page.tsx:111-141` | Nút **Verify Proof là giả**. Khi API OK: đặt `verified: true` mà không kiểm gì (không tính hash, không đối chiếu chain/checkpoint). Khi API lỗi (vd. 401): **vẫn** hiện "Verified… unbroken chain" với hash gán cứng `0xe708441f…`, `count` tự bịa (`steps*2` hoặc `6`), log "matches on-chain state". Ảnh `evidence/p2-mission-control-ui.png` chụp đúng trạng thái giả này. | Verify thật trên trình duyệt: dùng lại logic `scripts/verify-proof.ts` (canonicalJson, keccak, prevHash, đối chiếu checkpoint/head). Lỗi fetch hoặc chain sai → hiện **FAIL/UNVERIFIED**, không có giá trị mặc định. Xóa mọi hash/count gán cứng. Test: proof hợp lệ → PASS; sửa 1 entry → FAIL; 401 → không hiện verified. Chụp lại evidence. |
| **UI-02** | High | `page.tsx:104-109` | Nút **Pause Kill-Switch** chỉ đổi state React, không gọi `/api/system/pause`. Agent server vẫn chi tiêu bình thường. | Gọi route pause thật (owner ký challenge như flow hiện có); UI đọc lại trạng thái từ server (`/api/policy`). Test: pause → `/api/agent/run` trả 403. |
| **UI-03** | High | `page.tsx:145-160, 612` | Hàng chờ duyệt: Approve/Reject chỉ sửa state client, không qua API hay chữ ký owner. | Nối với `TreasuryRequest` thật (route queue hiện có, owner ký). Ở S1 không có payout: hiển thị trống + nhãn "S2", không cho bấm giả. |
| **UI-04** | Medium | `page.tsx:653`, header, badge ngân sách | Ở MOCK nhưng UI ghi "on-chain budget enforcement, real x402 payment rails", "Interactive S1 Production Demo", badge "USDC Fuji (43113)". | Text phụ thuộc mode: MOCK ghi rõ "MOCK — local simulation". Chỉ ghi "on-chain"/"Fuji" khi có tx thật. |
| **UI-05** | Medium | `page.tsx:978` | Thẻ "Guarded" in cứng lý do "recipient not allowlisted; over per-tx cap", trong khi verdict thật là `STAGE_S1_NO_TREASURY`. | Render đúng `verdict.rule` và `verdict.reason` từ response. |

### 2.3 Chưa đạt: guard chưa nối vào luồng thật

| ID | Mức | Vị trí | Vấn đề | Yêu cầu |
|---|---|---|---|---|
| **P2-PRICE** | High | `lib/validator.ts:297` | `verifyQuoteAgainstCatalog` **chỉ được gọi trong test**, không có trong `payments.ts` hay route nào. Report ghi PASS là sai. | Gọi trong luồng thanh toán trước khi reserve/sign: quote vượt giá niêm yết hoặc cap/call → BLOCK + audit. Test qua handler thật (`/api/agent/run` hoặc `/api/tools/orchestrate`), không chỉ gọi hàm. |
| **KEY-02b** | Medium | `lib/config.ts:86` | `validateLiveFujiConfig()` chỉ chạy trong `/api/agent/run`. Các route chi tiêu khác (`/api/tools/orchestrate`, `/api/tools/[id]`, TalkMeter) ở LIVE_FUJI không được chặn. | Gọi ở một điểm chung cho mọi đường chi tiêu (vd. trong `payments.ts` khi mode LIVE, hoặc `instrumentation.ts` lúc khởi động). Test cho ít nhất 1 route ngoài agent. |
| **INJ-01** | Medium | `lib/tools.ts:52-59` | Search trả fixture "adversarial" mỗi khi query chứa `injection/attack/jailbreak/compromise`. Câu hỏi nghiên cứu thật (vd. "51% attack Avalanche") sẽ nhận dữ liệu giả. | Chỉ bật bằng cờ demo rõ ràng (env `DEMO_ADVERSARIAL=1` + tham số preset), không dựa vào từ khóa. Kết quả gắn `fixture: true`. |

### 2.4 Ghi chú cho pitch (không phải lỗi code)

Ở S1, injection bị chặn bởi `STAGE_S1_NO_TREASURY`, tức là chặn mọi payout. Câu chuyện cho giám khảo yếu hơn so với "bị chặn vì không có trong allowlist / vượt cap". Khi lên S2 (contract trên Fuji), quay demo tấn công với rule allowlist/cap và revert on-chain.

## 3. Nhiệm vụ tiếp theo (đúng thứ tự)

1. **UI-01 → UI-05** (ưu tiên tuyệt đối; không thêm feature mới trước khi xong).
2. **P2-PRICE, KEY-02b, INJ-01**, kèm test gọi handler thật.
3. Chụp lại toàn bộ evidence UI sau khi sửa; xóa ảnh cũ chụp trạng thái giả (`evidence/p2-mission-control-ui.png`, `evidence/p1-c-prompt-injection-defense.png`) hoặc thay bằng ảnh mới.
4. Fuji live / LIVE_LLM vẫn chờ owner điền `.env` (ví test mới, `GEMINI_API_KEY`).

## 4. Acceptance lượt tới

| ID | Điều kiện đạt | Bằng chứng |
|---|---|---|
| UI-01 | Verify thật; tamper → FAIL; 401 → UNVERIFIED; không còn hash/count gán cứng | Test Playwright 3 case + grep không còn `0xe708441f`/`0x7e4b2d1c` trong `page.tsx` |
| UI-02 | Pause gọi API, agent run bị 403 khi paused | Test |
| UI-03 | Queue lấy từ DB, approve qua API có chữ ký; S1 hiện trống | Test/ảnh |
| UI-04/05 | Text theo mode; lý do lấy từ verdict | Ảnh |
| P2-PRICE | BLOCK qua handler thật | Test |
| KEY-02b | Route ngoài agent cũng fail ở LIVE khi config sai | Test |
| INJ-01 | Không kích hoạt fixture qua từ khóa | Test |

## 5. Giới hạn thực thi

- **Không hiển thị kết quả kiểm chứng, giao dịch, verdict hay trạng thái mà hệ thống không thực sự tạo ra.** Không dùng giá trị mặc định/gán cứng thay cho kết quả thật. Đây là điều kiện bắt buộc cho mọi UI/deck/video.
- Agent và UI dùng lại validator, caps, payment lifecycle, auth đã nghiệm thu.
- Không dùng khóa Anvil/Hardhat trên Fuji hay mạng công khai nào; không đọc/in/commit key.
- Không push `main`, không deploy public, không nộp bài khi owner chưa duyệt.
- Report chỉ ghi PASS khi tính năng được gọi trong luồng thật và có test qua handler/UI thật.

## 6. Prompt cho Gemini

~~~text
Đọc REVIEW_PROMPT_GPT.md (bản 02:15). Báo cáo ngắn vào REPORT_REVIEW_AND_FIX_COMPLETION.md.

Chấp nhận: AG-05, AG-04, AG-07; reviewer chạy lại vitest 89/89, tsc exit 0.

Chặn nộp bài — sửa trước mọi việc khác:
- UI-01 (critical): nút Verify Proof đang giả: luôn hiện verified, và khi API lỗi còn bịa
  hash 0xe708441f… và count. Verify thật trên trình duyệt (logic verify-proof.ts),
  lỗi/tamper → FAIL/UNVERIFIED, xóa mọi giá trị gán cứng; 3 test Playwright.
- UI-02: Pause phải gọi /api/system/pause thật và đọc lại trạng thái từ server.
- UI-03: Approval queue phải lấy từ TreasuryRequest thật, approve qua API có chữ ký owner;
  S1 hiển thị trống.
- UI-04/05: text theo mode (MOCK ghi rõ), lý do Guarded lấy từ verdict thật.
Sau đó: P2-PRICE (nối verifyQuoteAgainstCatalog vào luồng thanh toán thật, test qua handler),
KEY-02b (chặn LIVE config sai ở mọi route chi tiêu), INJ-01 (fixture adversarial chỉ bật
bằng cờ demo, không theo từ khóa). Chụp lại evidence, thay ảnh cũ.

Quy tắc: không hiển thị kết quả mà hệ thống không thực sự tạo ra.
Commit trên feat/s1-app, không push main, không deploy public.
~~~

## 7. Nhật ký reviewer

Chỉ sửa REVIEW_PROMPT_GPT.md.
Lệnh đã chạy: đọc output watcher; `git log`, `git diff --stat ba587af HEAD`; grep các nơi gọi `validateLiveFujiConfig`, `verifyQuoteAgainstCatalog`, `ALLOW_AGENT_TEST_OVERRIDE`, injection trong `tools.ts`/`agent.ts`; `sed` `page.tsx` (verify, pause, queue); xem `evidence/p2-mission-control-ui.png`; `vitest run` toàn bộ (89/89); `tsc --noEmit --incremental false` (exit 0).
