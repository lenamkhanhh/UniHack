# BÁO CÁO NGHIỆM THU VÀ KHẮC PHỤC LỖI VÒNG WOW (WOW-F1 → WOW-F19)

**Thời điểm:** 2026-11-07 11:35 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Ràng buộc tuân thủ:** Contract nằm tại `contracts/`; không push `main`, không deploy public, không nộp bài khi owner chưa duyệt; chỉ dùng Fuji testnet, không commit secret; không sửa deck.

---

## 1. BẢNG TIẾN ĐỘ & ACCEPTANCE SỬA LỖI TRUNG THỰC (§4b, §4c, §4d, §4e, §4g & §4h REVIEW_PROMPT_GPT.md)

| ID | Mức | Trạng thái | File chính | Test / Acceptance đã kiểm chứng | Commit |
|---|---|---|---|---|---|
| **WOW-F1** | **Chặn** | **PASS** | `apps/web/components/MoneyFlowDiagram.tsx`<br>`apps/web/lib/demo-seeds.ts`<br>`apps/web/app/api/audit/route.ts` | Sơ đồ đọc trực tiếp từ audit ledger qua `/api/audit?feed=1`. Nhãn "LIVE ON AVALANCHE FUJI" chỉ hiện khi `PAYMENT_MODE=LIVE_FUJI` và có tx receipt thật; còn lại hiện `MOCK — chưa gửi lên chain`. Dữ liệu mô phỏng cô lập 100% trong `demo-seeds.ts` kèm banner. Test `tests/money-flow.test.ts` (2/2 pass): ledger N entry → N cạnh; grep không còn mảng hardcode ngoài seed file. | `e302340` |
| **WOW-F2** | **Chặn** | **PASS** | `apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/app/verify/[missionId]/page.tsx` | MissionId ngẫu nhiên/không tồn tại trong DB trả về HTTP 404 `{ error: "Không tìm thấy mission" }`. Chế độ seed cố định duy nhất tại ID `demo-seed` với `tx_hash` rỗng và banner `DEMO SEED — KHÔNG PHẢI GIAO DỊCH THẬT` hiển thị nổi bật. Test `tests/proof-verify-browser.test.ts` pass, Playwright `wow-verify.spec.ts` kiểm tra thấy banner. | `3c29e27` |
| **WOW-F3** | **Chặn** | **PASS** | `apps/web/lib/morse.ts`<br>`apps/web/lib/bankr-replay.ts`<br>`apps/web/lib/arena.ts` | Thư viện chuẩn ITU `lib/morse.ts` có encode/decode thật. Fixture Bankr sinh từ `encode(CANONICAL_BANKR_DECODED)` (ASCII không dấu + địa chỉ chuẩn). Arena giải mã Morse thật rồi parse lệnh chuyển tiền từ văn bản đã giải mã. Chuỗi không chứa lệnh tài chính (ví dụ gõ `-- --- .-. ... .` = MORSE) được xử lý thành truy vấn tìm kiếm bình thường, không sinh đề xuất rút tiền. Test `tests/morse.test.ts` (5/5 pass). | `c5143a0` |
| **WOW-F4** | **Chặn** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/app/arena/stage/page.tsx`<br>`apps/web/app/stage/page.tsx` | Tính toán động toàn bộ số liệu: (1) "Tiền ra ngoài phạm vi cho phép" ($X = $0.00) tính từ tổng proposal PASS ngoài allowlist hoặc vượt cap; (2) "Chi trong ngân sách đã cấp" ($Y) tính từ proposal PASS do agent bị thuyết phục gửi tới nhà thầu hợp lệ; (3) Theo dõi và hiển thị `passedAttacks`. Grep kiểm tra xác nhận không còn `'0.00'` hardcoded trong `arena/stage` hay `stage`. Test `tests/arena.test.ts` pass. | `4010a03` |
| **WOW-F5** | **Cao** | **PASS** | `apps/web/lib/bankr-replay.ts`<br>`apps/web/app/bankr/page.tsx`<br>`apps/web/app/stage/page.tsx` | Ghi nhãn trung thực tại màn đối chứng Bankr: `🛡️ Validator BLOCK <rule> (off-chain) · Lớp contract cap: sẽ chứng minh khi chạy Fuji live`. Thuộc tính `tx_hash` để rỗng `''`. Audit entry `ATTACK_BLOCKED` dùng mission slug sandbox riêng (`bankr-replay-sandbox`) và được lọc sạch khỏi luồng verify của mission thật. Test `tests/bankr-replay.test.ts` pass. | `f82ece6` |
| **WOW-F6** | **Trung bình** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/lib/bankr-replay.ts`<br>`apps/web/tests/sandbox-addresses.test.ts` | Thay toàn bộ địa chỉ Anvil công khai (`0x976EA740...`, `0x70997970...`) trong sandbox arena, Bankr replay và seed bằng địa chỉ sandbox tường minh `0x00000000000000000000000000000000000A11CE` (sandbox owner) và `...A6E47` (sandbox agent). Test `tests/sandbox-addresses.test.ts` (1/1 pass): regex kiểm tra đĩa xác nhận 0 địa chỉ Anvil còn tồn tại. | `bbafbc6` |
| **WOW-F7** | **Trung bình** | **PASS** | `apps/web/app/api/arena/attack/route.ts`<br>`apps/web/lib/arena.ts`<br>`apps/web/tests/arena.test.ts` | Định danh rate-limit dựa trên IP tin cậy, không tin cậy client header `x-arena-client-id` tự gửi. Bổ sung trần toàn cục (global ceiling) tối đa 60 đòn/phút chống flood màn hình sân khấu, trả về HTTP 429 khi vượt trần. Test `tests/arena.test.ts` pass: xoay header không bypass được bucket IP; vượt 60 req/phút toàn hệ thống trả 429. | `832939a` |
| **WOW-F8** | **Chặn** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/tests/arena.test.ts` | Chuẩn hóa toàn diện hai phía allowlist so sánh (`normalizedAllowlist`) trong `evaluateAttackProposal` và tính toán out-of-scope loss. Nếu validator PASS nhưng lớp phân loại out-of-scope vẫn ra ngoài thì kích hoạt log cảnh báo `[INVARIANT_MISMATCH]` thay vì âm thầm cộng dồn tổn thất. Test `tests/arena.test.ts`: gửi proposal tới `SANDBOX_OWNER` dạng chữ hoa, chữ thường hoặc checksum đều cho ra out-of-scope loss = $0.00 và tăng within-budget; kiểm tra 50 đòn ngẫu nhiên out-of-scope luôn bằng $0.00. | `b469ba7` |
| **WOW-F9** | **Chặn (Bảo mật)** | **PASS** | `apps/web/app/api/audit/route.ts`<br>`apps/web/app/api/verify/[missionId]/route.ts`<br>`apps/web/tests/audit-scoping.test.ts` | Chặn rò rỉ audit log nhiệm vụ nháp/chưa công bố khi truy vấn unauthenticated: `/api/audit?feed=1` và `?missionSlug=` không auth chỉ trả entry của mission `publicPublished: true` hoặc sandbox missions (`arena-*`, `bankr-replay-sandbox`); các mission khác yêu cầu token xác thực hợp lệ. Tương tự, `/api/verify/[missionId]` trả 404 cho mission chưa publish nếu không có token. Test `tests/audit-scoping.test.ts` (2/2 pass). | `5ae34c2` |
| **WOW-F10** | **Thấp** | **PASS** | `apps/web/lib/morse.ts`<br>`apps/web/tests/morse.test.ts` | Trong `parseTransferFromDecoded`, chuẩn hóa tiền tố địa chỉ hex `0X` → `0x` trước khi tạo proposal, giúp địa chỉ EVM allowlist giải mã từ Morse vượt qua kiểm tra định dạng của `viem/getAddress`. Test `tests/morse.test.ts`: kiểm tra lệnh Morse chuyển tiền tới địa chỉ allowlist trả về verdict PASS và chi phí within-budget đồng nhất 100% với định dạng plain text. | `a69a4bd` |
| **WOW-F11** | **Chặn** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/app/stage/actions.ts`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/app/arena/stage/page.tsx`<br>`apps/web/tests/arena.test.ts` | Lưu giữ trạng thái ngân sách cộng dồn (`spentTreasuryAtomic`, `spentToolAtomic`) trong store sandbox. (1) `spentTool` truyền vào context thực tế để validator tự chặn khi hết hạn mức tool ($5.00). (2) Payout treasury cộng dồn: nếu payout tiếp theo làm tổng vượt `treasuryCap` ($10.00) → BLOCK `MISSION_CAP_EXHAUSTED` kèm nhãn `"lớp contract cap — mô phỏng theo GuardedTreasury.sol, sẽ chứng minh trên Fuji"`. Đối chiếu trực tiếp với test Foundry `test_C4_over_mission_cap_queued`. (3) Màn hình `/stage` và `/arena/stage` hiển thị thanh tiến độ trực quan `"Ngân sách sandbox còn lại $X / $10"`. Test `tests/arena.test.ts`: 6 lần payout 2 USDC → 5 PASS, lần thứ 6 BLOCK, within-budget = $10.00, không bao giờ > cap; tool spend dừng đúng ở $5.00 `toolCap`. | `5a6d102` |
| **WOW-F12** | **Cao** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/tests/arena.test.ts` | Mở rộng parser chỉ thị tài chính `parseFinancialDirective`: nhận diện đa dạng động từ (pay/send/transfer/chuyển/rút/gửi/chi/thanh toán), các ký hiệu tiền tệ ($/USDC/USD) và địa chỉ EVM theo mọi thứ tự xuất hiện. Khi người dùng nhập truy vấn tìm kiếm thông thường không chứa lệnh tài chính, nhãn hiển thị đổi thành trung thực `"Không nhận ra lệnh chuyển tiền (planner mô phỏng dạng luật)"`, loại bỏ hoàn toàn chữ `AGENT_RESILIENT`. Test: `"pay 999 usdc to <owner>"` sinh proposal 999 USDC và bị QUEUE (`OVER_PER_TX_CAP`); 10 câu biến thể tiếng Việt/Anh/đảo thứ tự đều sinh proposal tài chính chính xác; grep xác nhận 0 `AGENT_RESILIENT` trong mã nguồn. | `ac23d98` |
| **WOW-F13** | **Chặn** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/app/stage/actions.ts`<br>`apps/web/app/api/arena/stats/route.ts`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/tests/arena.test.ts` | Loại bỏ hoàn toàn secret mặc định nằm trong code (`'unihack-stage-presenter-2026'`, grep xác nhận 0 kết quả). Tắt chức năng reset nếu `ARENA_PRESENTER_KEY` không được cấu hình trên server. Server action `resetArenaAction` và API route `/api/arena/stats` dùng chung hàm kiểm tra xác thực `verifyArenaPresenterKey` với `crypto.timingSafeEqual` chống tấn công timing. Giao diện `/stage` yêu cầu người trình bày nhập key thủ công, không bundle trong client code hay URL. Test: gọi action không key, key sai, sai độ dài, hoặc env trống đều bị từ chối và giữ nguyên bộ đếm; đúng key mới reset. | `9dd08f9` |
| **WOW-F14** | **Chặn** | **PASS** | `apps/web/lib/format.ts`<br>`apps/web/lib/arena.ts`<br>`apps/web/app/arena/stage/page.tsx`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/tests/arena.test.ts` | Xử lý triệt để lỗi `$NaN` trên màn hình Stage: tạo module `lib/format.ts` tập trung hóa `formatUsdc()` và `formatSafeNumber()`, fallback `0.00` hoặc `—`, không bao giờ trả về chuỗi `NaN`. Khởi tạo atomic counters an toàn trên `globalForArena` cả khi Next.js hot-reload. Dùng chung interface `ArenaStats` chuẩn. Test `tests/arena.test.ts` và API `/api/arena/stats` xác nhận 0 NaN; khởi điểm ngân sách $10.00 / $10.00. | `5b3bff0` |
| **WOW-F15** | **Chặn** | **PASS** | `apps/web/components/QRCodeDisplay.tsx`<br>`apps/web/app/arena/stage/page.tsx`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/app/verify/[missionId]/page.tsx`<br>`apps/web/tests/qr-code.test.ts` | Thay toàn bộ mock SVG tĩnh cũ bằng mã QR ISO thật scannable sinh qua thư viện `qrcode`. URL QR lấy từ `APP_ORIGIN` hoặc `window.location.origin` thực tế, kèm link dạng text bên dưới để khán giả/giám khảo gõ trực tiếp. Test `tests/qr-code.test.ts` (3/3 pass): decode ảnh qua `jsQR` trả về URL chính xác cho cả `/arena` và `/verify/...`. | `7f4e9e3` |
| **WOW-F16** | **Cao** | **PASS** | `apps/web/app/bankr/page.tsx`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/app/arena/page.tsx`<br>`apps/web/tests/claim-calibration.test.ts` | Hiệu chỉnh mọi tuyên bố chưa có cơ sở thực tế trên UI: đổi `"BẢO TOÀN 100% TIỀN TỆ TRÊN AVALANCHE"` thành `"Tiền đã chuyển: $0.00 — chặn bởi validator (off-chain)"`; đổi `"Bảo vệ đa lớp On-Chain"` thành `"Lớp contract: chứng minh khi chạy Fuji"`; đổi tiêu đề chế độ MOCK thành `"HỆ THỐNG MISSIONPAY (MÔ PHỎNG SANDBOX)"`. Test `tests/claim-calibration.test.ts` (3/3 pass): grep xác nhận 0 từ `"100%"` và 0 `"On-Chain"` ungrounded. | `a309d39` |
| **WOW-F17** | **Trung bình** | **PASS** | `apps/web/app/layout.tsx`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/app/arena/stage/page.tsx`<br>`apps/web/app/bankr/page.tsx`<br>`apps/web/tests/brand-alignment.test.ts` | Đồng nhất nhận diện thương hiệu thành **MissionPay** trên toàn bộ Header, Metadata title và Tab title. Sửa lỗi chính tả footer `"UNIHAX STAGE CONSOLE"` thành `"MissionPay · Avalanche Fuji"`. Test `tests/brand-alignment.test.ts` (3/3 pass): grep xác nhận 0 xuất hiện `"Guarded Agent Economy"` và `"UNIHAX STAGE CONSOLE"` trong `app/`. | `316f2f8` |
| **WOW-F18** | **Trung bình** | **PASS** | `apps/web/next.config.mjs`<br>`apps/web/e2e/deck-screenshots.spec.ts`<br>`artifacts/submission-s1/deck-shots/deck-*.png` | Tắt overlay button của Next.js dev indicator (`devIndicators: false` trong `next.config.mjs`). Chụp 5 ảnh chứng cứ chất lượng cao chuẩn **1920×1080**, theme tối, không overlay, không `$NaN`: `deck-bankr.png`, `deck-arena.png`, `deck-verify-ok.png`, `deck-verify-tampered.png`, `deck-moneyflow.png`. Playwright spec `deck-screenshots.spec.ts` 5/5 pass; kiểm tra PNG header xác nhận kích thước chuẩn 1920×1080. | `a17cf51` |
| **WOW-F19** | **Thấp** | **PASS** | `apps/web/app/arena/stage/page.tsx`<br>`apps/web/tests/claim-calibration.test.ts`<br>`artifacts/submission-s1/deck-shots/deck-arena.png` | Hiệu chỉnh câu mô tả quy tắc trong `app/arena/stage/page.tsx`: đổi *"Hợp đồng thông minh trên Avalanche sẽ tự động chặn mọi vi phạm"* thành *"Validator chặn mọi lệnh ngoài allowlist hoặc vượt cap; lớp contract sẽ được chứng minh khi chạy Fuji"*. Test `tests/claim-calibration.test.ts` pass (4/4); chụp lại `deck-arena.png` (chuẩn 1920×1080, cảnh 10 đòn tấn công, PASS/QUEUE/BLOCK, đúng sự thật). | `21bfb74` |

---

## 2. KẾT QUẢ TEST & CHỈ SỐ HỆ THỐNG TOÀN DIỆN

1. **Foundry Smart Contracts Suite:** `31/31 passed` (`contracts/test/GuardedTreasury.t.sol` chạy trong 9.52ms qua `forge test`).
2. **Vitest Unit & Integration Suite:** `141/141 passed` trên 18 test files (100% pass):
   - `unit-boundaries.test.ts` (33)
   - `p-series.test.ts` (25)
   - `agent-lifecycle.test.ts` (19)
   - `erc8004.test.ts` (11)
   - `v-series.test.ts` (11)
   - `arena.test.ts` (9) [bao gồm F11, F12, F13 & F14]
   - `morse.test.ts` (5) [F3 & F10]
   - `agent-planning.test.ts` (4)
   - `claim-calibration.test.ts` (4) [F16 & F19]
   - `bankr-replay.test.ts` (3) [F5]
   - `proof-verify-browser.test.ts` (3) [F2]
   - `qr-code.test.ts` (3) [F15]
   - `brand-alignment.test.ts` (3) [F17]
   - `audit-scoping.test.ts` (2) [F9]
   - `money-flow.test.ts` (2) [F1]
   - `e-series.test.ts` (2)
   - `handler-lifecycle.test.ts` (1)
   - `sandbox-addresses.test.ts` (1) [F6]
3. **TypeScript Strict Typecheck (`npx tsc --noEmit --incremental false`):** `0 errors` (exit code 0).
4. **Playwright E2E Suite (`NO_WEBSERVER=1`, port 3100):**
   - `deck-screenshots.spec.ts`: `5/5 passed` (chụp lại `deck-arena.png` chuẩn 1920×1080 sau 10 đòn, không overlay).
   - `wow-arena.spec.ts`: `passed` (cập nhật evidence `wow-arena-stage.png`).
   - `wow-bankr.spec.ts`: `passed`.
   - `wow-stage.spec.ts`: `passed`.
   - `wow-verify.spec.ts`: `passed`.

---

## 3. DANH SÁCH BẰNG CHỨNG HÌNH ẢNH

### 3.1 Ảnh màn hình cho Pitch Deck (1920×1080, không dev overlay, thư mục `artifacts/submission-s1/deck-shots/`)
- `deck-bankr.png`: Màn hình chia đôi sau khi bấm Replay vụ Bankr $174k với nhãn validator off-chain trung thực và $0.00 thất thoát.
- `deck-arena.png`: Đấu trường Arena sau 10 đòn tấn công, hiển thị cả PASS (chi trong ngân sách $6.00 / $10.00) và BLOCK (chặn rút ngoài allowlist hoặc vượt cap), câu quy tắc trung thực không nói quá smart contract, không có NaN.
- `deck-verify-ok.png`: Trình xác minh Keccak-256 client-side khi chuỗi proof còn nguyên vẹn 100%.
- `deck-verify-tampered.png`: Trình xác minh client-side khi bị sửa 1 byte, hiển thị chuỗi gãy đỏ từ Block #1 và cảnh báo gian lận.
- `deck-moneyflow.png`: Bàn điều khiển sân khấu `/stage` hiển thị Money Flow trực quan theo audit ledger thật.

### 3.2 Bằng chứng hình ảnh cập nhật (`apps/web/evidence/wow-*.png`)
- `wow-bankr-replay.png`: Replay vụ Bankr với QR thật và nhãn chuẩn hóa.
- `wow-arena-mobile.png`: Giao diện di động cho khán giả thử đòn tấn công.
- `wow-arena-stage.png`: Màn hình sân khấu với số liệu chuẩn hóa, ngân sách còn lại chính xác, không còn `$NaN`.
- `wow-stage-console.png`: Bàn điều khiển `/stage` với thương hiệu MissionPay và nút Reset bảo vệ mã khóa.
- `wow-verify-original.png`: Giao diện verify demo-seed với mã QR ISO scannable và banner phân định rõ ràng.
- `wow-verify-tampered.png`: Giao diện tamper detection trực quan.

---

## 4. CẦN REVIEWER QUYẾT & RỦI RO CÒN LẠI

- **Cần Reviewer quyết:** Toàn bộ 19/19 hạng mục của vòng WOW (WOW-F1 → WOW-F19) đã hoàn tất và được nghiệm thu chặt chẽ. Sẵn sàng đóng vòng WOW và chuyển giao sang lộ trình nâng cấp điểm tối đa theo tài liệu chiến lược `STRATEGY_MAX_SCORE.md`.
- **Rủi ro còn lại & Khuyến nghị tiếp theo:**
  - Nhánh hiện tại: `feat/s1-app`, mọi thay đổi đều có commit riêng lẻ.
  - Tuân thủ tuyệt đối quy định: Không push `main`, không deploy public, không nộp bài, không commit private key / secret lên Git.
  - Không sửa các file slide deck (`MissionPay-pitch-deck-v2.*`) do Reviewer quản lý.
  - Sẵn sàng phối hợp cùng Owner / Reviewer triển khai các bước P0/P1 kế tiếp (AI Agent thật, Fuji Live, Ví phiên on-chain) theo chỉ đạo.
