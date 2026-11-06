# UniHack — review hiện tại và nhiệm vụ tiếp theo

Cập nhật: 2026-11-07, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: d247015ee855f7ef48297ea9f49c606346efa690 (code app vẫn chưa commit).
Báo cáo: REPORT_REVIEW_AND_FIX_COMPLETION.md.
SHA-256 báo cáo đã đọc: 49c1ac200380e54b1dd8011e4a2b43859a5894f453b8dbbf213155696ad905a2.
Kế hoạch chiến lược: STRATEGY_MAX_SCORE.md (đọc kèm; đây là nguồn ưu tiên cho lượt này).

## 1. Hai file trao đổi cố định

- REVIEW_PROMPT_GPT.md: reviewer cập nhật verdict và yêu cầu hiện hành.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: Gemini cập nhật kết quả/evidence.

Cập nhật tại chỗ, không tạo review/report theo số vòng.
STRATEGY_MAX_SCORE.md là tài liệu kế hoạch, không phải file trao đổi; không ghi báo cáo vào đó.

## 2. Verdict

### 2.1 Giữ nguyên acceptance đã đạt

- CLEANUP-01, TEST-01, M6, R8, FIX-CLI/DEMO/CACHE: đã chấp nhận.
- Unit 33/33 (key có/vắng); DB-backed P/V/E 37/37; Vitest control 71/71.
- Browser UI-mocked 9/9 trên Chromium; real-integration 1/1 qua HTTP/Prisma/PostgreSQL, PAYMENT_MODE=MOCK.
- Proof mission 3 entries verify, khớp checkpoint DB.

Không mở thêm vòng hardening backend. Phần lifecycle thanh toán đã đủ cho cuộc thi.

### 2.2 Artifacts S1 (deck/video): chưa đạt để nộp

Đã đọc `artifacts/submission-s1/pitch-deck.pptx` (12 slide). Các lỗi phải sửa:

| ID | Slide | Lỗi | Yêu cầu |
|---|---|---|---|
| DECK-01 | 1, 9 | Ghi "Merkle audit proofs", thực tế là hash chain | Ghi đúng "hash-chained audit log" (+ "anchored on Avalanche" sau P1-B) |
| DECK-02 | 7 | Tiêu đề "Unmocked Vertical Flow" nhưng bước 1 ghi "MOCK Mode" | Demo chính phải LIVE Fuji; MOCK chỉ là chế độ dự phòng có nhãn |
| DECK-03 | 6 | "Agent's signing key can never spend beyond this boundary": sai khi key bị lộ (tool cap là off-chain) | Chỉ được claim sau P1-A; trước đó ghi rõ phạm vi |
| DECK-04 | 2 | Vấn đề chính là "gas exhaustion", vốn là tính năng của facilitator/EIP-3009, không phải của mình | Vấn đề: đưa ví cho agent = séc khống; dùng số liệu ở STRATEGY §3.4 |
| DECK-05 | 11 | Slide toàn số test/port | Thay bằng "Live on Fuji": contract verified, tx, agent ID, QR |
| DECK-06 | 1 | Tên sản phẩm "UniHack" trùng tên cuộc thi | Dùng brand do owner chốt (STRATEGY §3.3); chưa chốt thì để placeholder |

Video `demo.mp4` hiện quay ở MOCK, sẽ được thay bằng video LIVE theo STRATEGY §6.
Không xóa artifacts S1 cũ; tạo bản mới ở `artifacts/submission-final/`.

### 2.3 Finding sản phẩm mới (ưu tiên cao nhất)

| ID | Mức | Vị trí | Vấn đề |
|---|---|---|---|
| AGENT-01 | Critical (với chấm điểm) | `apps/web/lib/proposer.ts`, `apps/web/lib/tools.ts` | Chưa có AI agent: proposal dựng theo template cố định; summary là fixture. Track Agent mà không có LLM sẽ mất điểm Tech/Creativity và dễ bị bắt khi Q&A. |
| CHAIN-01 | Critical (với chấm điểm) | toàn hệ thống | Chưa có giao dịch on-chain nào: contract chưa compile/deploy, x402 chỉ MOCK, chưa dùng ERC-8004. Tiêu chí Avalanche Integration (25đ) gần như trống. |
| SUB-01 | Blocker nộp bài | git | `apps/`, `contracts/`, `scripts/` chưa commit; repo nộp lên sẽ không có code. |
| SUB-02 | High | root repo | 11 file `GEMINI_ROUND*.md` + handoff cũ ở root, gây rối khi giám khảo mở repo. |

## 3. Nhiệm vụ tiếp theo (đúng thứ tự, chi tiết trong STRATEGY_MAX_SCORE.md)

### Bước 0 — Hygiene (ngày 07–08/11)
- Commit toàn bộ code hiện có lên nhánh mới (ví dụ `feat/s1-app`); không commit `.env`, key, `node_modules`, `.next`, `ms-playwright`, `test-results`, `playwright-report`.
- Quét secret trước khi commit (agent key, JWT secret, DB URL).
- Dời `GEMINI_*.md`, `IMPLEMENTATION_NOTES.md` vào `docs/review-history/`. Giữ ở root: README, 2 file trao đổi, STRATEGY.
- Cài Foundry; `forge build` + `forge test` cho `contracts/`.

### Bước 1 — P0 AI agent thật (STRATEGY §4.1) — 08–10/11
- Planner LLM (temperature 0, JSON mode) → `ToolPurchaseProposal[] | TreasuryPayoutProposal | DONE` → `validator.ts` giữ nguyên.
- Vòng lặp tối đa 6 bước; kết quả tool đưa lại cho LLM; tạo deliverable + deliverableHash.
- `proposer.ts` thành fallback deterministic khi thiếu key, gắn nhãn trên UI.
- `search` dùng API thật (có cache có nhãn); `summary` gọi LLM thật.
- LLM không giữ key, không tự chọn mission, không thấy cap.
- Audit entry ghi model + prompt version.

### Bước 2 — P0 Fuji live (STRATEGY §4.2) — 09–12/11
- Deploy + verify `GuardedTreasury` trên Fuji (Snowtrace).
- x402 v1 `exact` `avalanche-fuji`: facilitator chính Ultravioleta, fallback PayAI (cả hai có trong `/supported` ngày 07/11).
- USDC Fuji `0x5425890298aed601595a70AB815c96711a31Bc65`.
- Mỗi tx trên UI có link Snowtrace. MOCK giữ lại, có nhãn.

### Bước 3 — P1 (STRATEGY §4.3–4.5) — 12–16/11
- P1-A: ví phiên theo mission, `fundMissionWallet` đúng toolCap + sweep khi close/expire, kèm events. Cập nhật bảng tổn thất tối đa.
- P1-B: ERC-8004 registry chính thức Fuji (Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`), pin ABI đã deploy; `MissionProofAnchored(missionId, headHash)` khi complete.
- P1-C: demo prompt injection: validator BLOCK + gọi thẳng contract revert; đối chứng ví nóng không guard (số nhỏ, Fuji).

### Bước 4 — P2 (STRATEGY §4.6–4.7) — 14–16/11
- Price-mismatch guard: quote 402 > giá niêm yết hoặc > cap/call → BLOCK + audit.
- Mission Control UI: thanh ngân sách (spent/reserved/còn lại), timeline có lý do + link Snowtrace, hàng chờ duyệt, Verify proof trên trình duyệt, nút Pause. Log kỹ thuật dời sang tab Developer.

### Bước 5 — Public + nộp (STRATEGY §6, §7, §9) — 16–20/11
- Deploy Vercel + Postgres hosted; smoke test từ máy/mạng khác.
- README mới: câu định vị, ảnh/GIF, Live links (app, contract, agent ERC-8004), Quickstart.
- Deck mới 11 slide (sửa DECK-01..06) → Google Slides/Canva public; video LIVE 2:30 theo kịch bản STRATEGY §6.
- **Feature freeze 18/11.** Nộp bài do owner thực hiện, không phải Gemini.

**Cut line 14/11:** nếu Bước 2 chưa có settlement thật, bỏ P1-A và P2. Dồn vào agent thật + 1 settlement thật + contract verified + demo tấn công.

## 4. Acceptance cho lượt tới

| ID | Điều kiện đạt | Bằng chứng phải có trong report |
|---|---|---|
| SUB-01 | Code đã commit trên nhánh, không có secret | `git log -1`, `git status --short -- .`, kết quả quét secret |
| SUB-02 | Root gọn | `ls` root |
| CON-01 | Contract tests pass | output `forge test` |
| AGENT-01 | 1 mission thật: LLM tự chọn ≥2 tool, deliverable có nguồn thật; fallback chạy khi không có key | log từng bước (proposal JSON → verdict), deliverableHash, ảnh UI |
| CHAIN-01a | GuardedTreasury verified trên Snowtrace | địa chỉ + link |
| CHAIN-01b | ≥2 settlement x402 LIVE trên Fuji | tx hash + link, operationId tương ứng |
| CHAIN-01c | 1 treasury payout thật + 1 revert do vượt cap | tx hash + link |
| P1-A..C | Theo Bước 3 | tx/event hash, ảnh màn hình |
| DECK-01..06 | Deck mới sửa đủ | đường dẫn file + ảnh từng slide đã đổi |

Không ghi report dài; mỗi ID tối đa 10 dòng + link evidence.
Không dùng MOCK/browser mocked để suy LIVE_VERIFIED.

## 5. Giới hạn thực thi

- Không đổi luật validator, caps, auth, payment lifecycle đã được chấp nhận, trừ phần cần cho P1-A/P2 (ghi rõ diff).
- Chỉ dùng Fuji testnet; không mainnet, không tiền thật.
- Không commit secret; API key LLM/search chỉ để trong `.env`.
- Không push lên `main`, không deploy public, không nộp bài khi chưa có owner duyệt từng việc.
- Không thêm stretch (L1 riêng, multisig, rolling cap, MCP) trước khi xong Bước 0–4.
- Không giả tx/receipt; claim trong deck/video phải khớp code và tx thật.

## 6. Prompt cho Gemini

~~~text
Đọc REVIEW_PROMPT_GPT.md và STRATEGY_MAX_SCORE.md.
Báo cáo trong REPORT_REVIEW_AND_FIX_COMPLETION.md (ghi đè phần cũ, giữ ngắn).
Chỉ hai file REVIEW/REPORT làm đầu mối trao đổi.

Acceptance cũ (71/71, browser 9/9 + 1/1, proof, CLEANUP-01) giữ nguyên.
Không mở thêm vòng hardening backend.

Mục tiêu mới: tối đa điểm rubric Team1 (Avalanche 25, Tech 25).
Làm đúng thứ tự Bước 0 → 5 ở mục 3:
0. Commit code lên nhánh (không secret), dọn root, cài Foundry + forge test.
1. AI agent thật: LLM planner JSON → validator hiện có; tool search/summary thật;
   proposer.ts làm fallback có nhãn.
2. Fuji live: deploy + verify GuardedTreasury; x402 v1 exact avalanche-fuji qua
   Ultravioleta (fallback PayAI); link Snowtrace cho mọi tx.
3. P1: ví phiên on-chain theo mission; ERC-8004 registry chính thức + proof anchor;
   demo prompt injection có đối chứng.
4. P2: price-mismatch guard; Mission Control UI.
5. README mới, deck sửa DECK-01..06, video LIVE 2:30 (artifacts/submission-final/).
Freeze 18/11. Cut line 14/11 như mục 3.

Báo cáo theo bảng acceptance mục 4: mỗi ID có lệnh đã chạy, tx hash/link, file đã sửa,
phần còn thiếu/blocker. Không push main/deploy public/nộp bài nếu owner chưa duyệt.
~~~

## 7. Nhật ký reviewer

Chỉ sửa REVIEW_PROMPT_GPT.md; không sửa report, code, test, config hay package.
STRATEGY_MAX_SCORE.md được tạo ở lượt trước theo yêu cầu owner.

Đã thực thi lượt này:
- Đọc REVIEW_PROMPT_GPT.md cũ; sha256sum REPORT_REVIEW_AND_FIX_COMPLETION.md (hash ở đầu file); grep heading của report.
- python-pptx trích text 12 slide `artifacts/submission-s1/pitch-deck.pptx`.
- Đọc `apps/web/lib/proposer.ts`, `apps/web/lib/chain.ts`, grep `apps/web/lib/tools.ts`, liệt kê hàm `contracts/src/GuardedTreasury.sol`.
- curl `/supported` của Ultravioleta và PayAI: cả hai có x402 v1 `avalanche-fuji`.
- git log/status giới hạn trong repo UniHack.

Không chạy lại tests/build/DB/browser trong lượt này; không có tx Fuji nào được gửi.
