# UniHack — review hiện tại và nhiệm vụ tiếp theo

Cập nhật: 2026-11-07 02:45, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack — nhánh `feat/s1-app`, HEAD `95cb2c3`.
Báo cáo đã đọc: REPORT_REVIEW_AND_FIX_COMPLETION.md (bản commit `95cb2c3`).
Kế hoạch: STRATEGY_MAX_SCORE.md.

## 1. Hai file trao đổi cố định

- REVIEW_PROMPT_GPT.md: reviewer cập nhật verdict và yêu cầu hiện hành.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: Gemini cập nhật kết quả/evidence (ngắn, theo bảng acceptance).

## 2. Verdict

### 2.1 Chấp nhận (reviewer đã kiểm lại)

| ID | Kết quả |
|---|---|
| **UI-01** | **Đạt.** `lib/proof-verifier.ts` tính lại keccak/canonicalJson/prevHash/checkpoint thật; lỗi fetch → UNVERIFIED, chain sai → FAIL; `page.tsx` không còn hash/count gán cứng. |
| UI-02 | Đạt phần UI: gọi challenge → ký → `/api/system/pause` → đọc lại `/api/policy`. (Xem UI-02b.) |
| UI-03 | Đạt. S1 hiển thị banner vô hiệu, không còn nút duyệt giả. |
| UI-04/05 | Đạt. Text theo mode; lý do Guarded lấy từ verdict. |
| P2-PRICE | Đạt. `verifyQuoteAgainstCatalog` được gọi trong `reserveOperation` + agent route; BLOCK có audit. |
| KEY-02b | Đạt. `validateLiveFujiConfig()` trong `payments.ts` + `/api/tools/orchestrate`. |
| Test | Reviewer chạy lại: vitest **91/91**; Playwright `mission-control.spec.ts` **5/5**; `tsc` exit 0. |

Ghi chú: trong lúc chạy Playwright, reviewer vô tình ghi đè 2 ảnh evidence và đã khôi phục bằng `git checkout`. Working tree sạch.

### 2.2 Còn mở (nhỏ)

| ID | Mức | Vị trí | Vấn đề | Yêu cầu |
|---|---|---|---|---|
| UI-02b | Medium | `e2e/mission-control.spec.ts:113,133` | Test pause mock cả `/api/system/pause` lẫn `/api/agent/run`, nên chưa chứng minh **server thật** trả 403 khi paused. Vitest cũng chưa có case này. | Thêm test gọi handler thật: set pause qua route (owner ký) → `/api/agent/run` và `/api/tools/orchestrate` trả 403 → unpause → chạy lại được. |
| VER-02 | Low | `lib/proof-verifier.ts:93` vs `scripts/verify-proof.ts:79` | Verifier trình duyệt **bỏ qua** kiểm `prev_hash` bên trong khi trường này vắng; CLI thì bắt buộc. Hai bản logic có thể lệch nhau. | Dùng **một** module chung cho cả CLI và trình duyệt; giữ quy tắc chặt của CLI. Test: entry thiếu inner `prev_hash` → FAIL ở cả hai. |
| INJ-01b | Low | `lib/agent.ts:105-109`, `lib/tools.ts:57` | Fixture adversarial vẫn bật theo từ khóa trong goal (`adversarial`, `p1-c`, `exploit detection`) hoặc theo tham số client `demoAdversarial`. | Chỉ bật khi `DEMO_ADVERSARIAL=1` và không phải production; nút preset trên UI gửi cờ rõ ràng. Không dựa vào từ khóa. |
| HYG-01 | Low | `apps/web/tsconfig.tsbuildinfo` | File build cache đang được git track. | Thêm vào `.gitignore`, `git rm --cached`. |

## 3. Nhiệm vụ tiếp theo (đúng thứ tự)

Fuji live vẫn chờ owner. Trong lúc chờ, làm hết phần contract/tích hợp **có thể test local** để khi có ví chỉ cần deploy.

1. **Sửa nhỏ:** UI-02b, VER-02, INJ-01b, HYG-01.
2. **P1-A ví phiên on-chain** (STRATEGY §4.3), viết + test bằng Foundry:
   - `fundMissionWallet(missionId, wallet)`: chỉ owner gọi, chuyển đúng `toolCap` của mission, mỗi mission đúng 1 lần.
   - `sweepMissionWallet(missionId)` / luồng trả dư khi close/expire; events `MissionFunded`, `MissionSwept`.
   - Forge tests: fund 2 lần → revert; fund vượt số dư → revert; agent gọi → revert; mission đóng/hết hạn → không fund.
   - Backend: tạo ví phiên theo mission (key lưu server-side, không log, không commit), dùng ví này ký EIP-3009 thay cho key agent chung khi `STAGE=S2`.
   - Cập nhật bảng tổn thất tối đa trong spec/README.
3. **P1-B proof anchor + ERC-8004 client**:
   - Contract: `anchorMissionProof(missionId, headHash)` (owner), event `MissionProofAnchored`; forge test.
   - Backend: khi complete mission ở S2 → gửi tx anchor (MOCK: ghi rõ chưa gửi). Verifier trình duyệt hiển thị "khớp hash neo on-chain" **chỉ khi** đọc được event thật.
   - ERC-8004: module gọi `IdentityRegistry`/`ReputationRegistry` Fuji (địa chỉ trong STRATEGY §4.4), pin ABI từ contract đã verify; test với mock/anvil fork. `giveFeedback` chỉ sau operation SETTLED và owner xác nhận.
4. **Script deploy Fuji sẵn sàng** (`contracts/script/Deploy.s.sol` + hướng dẫn README): đọc key từ env, từ chối key Anvil, in địa chỉ + lệnh verify Snowtrace. **Không broadcast.**

## 4. Acceptance lượt tới

| ID | Điều kiện đạt | Bằng chứng |
|---|---|---|
| UI-02b | Pause thật → 403 ở agent + orchestrate; unpause chạy lại | Tên test + output |
| VER-02 | Một module verifier; thiếu inner prev_hash → FAIL cả hai | Test |
| INJ-01b | Không bật theo từ khóa; chỉ env + non-production | Test |
| HYG-01 | tsbuildinfo không còn tracked | `git ls-files` |
| P1-A | Hàm + events + forge tests pass; backend dùng ví phiên ở S2 | `forge test` output, test backend |
| P1-B | Anchor + event + test; ERC-8004 module + test mock | `forge test`, vitest |
| DEPLOY-READY | Script deploy chạy được với `--dry-run`/simulation, chặn key Anvil | Output simulation |

## 5. Giới hạn thực thi

- Không hiển thị kết quả, giao dịch, verdict hay trạng thái mà hệ thống không thực sự tạo ra.
- Không broadcast giao dịch lên Fuji khi owner chưa điền ví mới vào `.env` và chưa duyệt.
- Không dùng khóa Anvil/Hardhat trên Fuji/mạng công khai; không đọc/in/commit key.
- Không đổi luật validator, caps, payment lifecycle đã nghiệm thu (P1-A chỉ thêm đường ví phiên cho S2).
- Không push `main`, không deploy public, không nộp bài khi owner chưa duyệt.

## 6. Prompt cho Gemini

~~~text
Đọc REVIEW_PROMPT_GPT.md (bản 02:45). Báo cáo ngắn vào REPORT_REVIEW_AND_FIX_COMPLETION.md.

Chấp nhận: UI-01..05, P2-PRICE, KEY-02b. Reviewer chạy lại vitest 91/91,
Playwright mission-control 5/5, tsc exit 0.

Làm theo mục 3:
1. Sửa nhỏ: UI-02b (test pause trên server thật), VER-02 (gộp verifier CLI/browser,
   giữ quy tắc chặt), INJ-01b (fixture adversarial chỉ bật bằng env, không theo từ khóa),
   HYG-01 (bỏ track tsbuildinfo).
2. P1-A ví phiên on-chain: fundMissionWallet/sweep + events + forge tests; backend ký bằng ví
   phiên ở S2.
3. P1-B anchorMissionProof + event + test; module ERC-8004 + test mock.
4. Script deploy Fuji sẵn sàng, chỉ simulation, chặn key Anvil. KHÔNG broadcast.

Commit trên feat/s1-app, không push main, không deploy public.
~~~

## 7. Nhật ký reviewer

Chỉ sửa REVIEW_PROMPT_GPT.md; khôi phục 2 ảnh evidence bị test của reviewer ghi đè (`git checkout`).
Lệnh đã chạy: đọc output watcher; `git log`, `git diff --stat 25e1dcf HEAD`; grep `page.tsx` (hash gán cứng, verify handler), `agent.ts`/`tools.ts` (demoAdversarial); so `proof-verifier.ts` với `scripts/verify-proof.ts`; `vitest run` (91/91); `tsc` (exit 0); `playwright test e2e/mission-control.spec.ts` với `NO_WEBSERVER=1` trên dev server :3100 (5/5); grep `page.route` trong spec; `git ls-files apps/web/tsconfig.tsbuildinfo`.
