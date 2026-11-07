# BÁO CÁO HOÀN THÀNH TOÀN BỘ VÒNG REVIEW PROVENANCE (PV-F1 → PV-F10)

**Thời điểm:** 2026-11-07 17:25 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Ràng buộc tuân thủ nghiêm ngặt:**
- Contract đặt tại `contracts/` (không phải `packages/contracts`).
- TUYỆT ĐỐI KHÔNG sửa 3 file slide của Reviewer (`MissionPay-pitch-deck-v2.pdf`, `MissionPay-pitch-deck-v2.pptx`, `artifacts/submission-s1/deck-v2/build_deck.js`).
- Không push `main`, không deploy public, không nộp bài khi chưa có lệnh owner.
- Không broadcast Fuji trong vòng này (chỉ simulation/dry-run trên local/RPC). Không commit secret / private key.

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU THEO YÊU CẦU REVIEWER (§4k REVIEW_PROMPT_GPT.md)

### Đợt PV-F1 → PV-F9 (Đã được Reviewer xác nhận ĐẠT)
| ID | Mức | Trạng thái | File chính | Test / Acceptance đã kiểm chứng | Commit |
|---|---|---|---|---|---|
| **PV-F1** | **P0** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/tests/arena.test.ts` | Template Zscaler nạp fixture JSON-LD (`0xbad...`, `$3.00`) vào `taintRegistry` với nguồn `WEB` trước khi validate → BLOCK `RECIPIENT_UNTRUSTED_PROVENANCE`. | `43b757e` |
| **PV-F2** | **P0** | **PASS** | `apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/provenance.test.ts` | `agent/run` lấy tập payee đã ký riêng cho từng mission từ DB; allowlist toàn cục chỉ là điều kiện giao; payee ngoài tập bị chặn khỏi `OWNER_MISSION`. | `decdd81` |
| **PV-F3** | **P0** | **PASS** | `apps/web/prisma/schema.prisma`<br>`apps/web/lib/config.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/missions/[slug]/activate/route.ts` | Lưu `payeesJson` và `payeeRoot` vào Postgres qua Prisma migration; thống nhất địa chỉ treasury qua `getGuardedTreasuryAddress()`. | `cf07c3a` |
| **PV-F4** | **P1** | **PASS** | `apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/merkle-payee.test.ts` | Server tính Merkle proof và đính kèm calldata `proposeWithProof` vào `treasuryRequest`; chặn người nhận ngoài tập với `PAYEE_NOT_IN_MISSION_SET`. | `f7d1b7e` |
| **PV-F9** | **P0** | **PASS** | `apps/web/lib/merkle.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/missions/[slug]/activate/route.ts` | DB là nguồn duy nhất, không ghi cache RAM trước khi xác minh chữ ký; đổi payee tại activate tự động tăng `configVersion` và thu hồi spend token cũ. | `53bd1ec`<br>`c597832` |
| **PV-F5** | **P1** | **PASS** | `apps/web/lib/validator.ts`<br>`apps/web/tests/provenance.test.ts` | Regex `isPolicyChangeAttempt` dùng word boundary `\b`, chỉ quét `reason` payout và `tool_id`; loại bỏ quét arguments của tool tìm kiếm. | `2a4fa65` |
| **PV-F6** | **P1** | **PASS** | `scripts/fuji-tainted-payee-revert.ts` | Loại bỏ fallback Anvil private key #1 trong `fuji-tainted-payee-revert.ts`; dry-run chỉ dùng địa chỉ `AGENT_ADDRESS` (không cần key); simulation revert đúng spec. | `83ac0f9` |
| **PV-F7** | **P2** | **PASS** | `apps/web/lib/dto.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/page.tsx`<br>`apps/web/app/stage/page.tsx` | Dashboard mission và Stage hiển thị badge `"⚠ Payee root chưa lên chain"` khi chưa có xác nhận receipt trên Fuji, và `"✓ Payee root on-chain"` khi đã verify receipt. | `64cba74` |
| **PV-F8** | **P2** | **PASS** | `apps/web/app/arena/stage/page.tsx`<br>`apps/web/app/api/arena/stats/route.ts`<br>`apps/web/e2e/deck-screenshots.spec.ts` | Chuẩn hóa câu Quy tắc Arena: "Validator chặn người nhận không truy về chữ ký owner, lệnh vượt cap, và mọi lệnh đổi policy". Chụp lại chuỗi ảnh deck-shots 1920×1080. | `fb7714c`<br>`cef0c26`<br>`7711421` |

### Đợt Bổ sung PV-F10
| ID | Mức | Trạng thái | File chính | Test / Acceptance đã kiểm chứng | Commit |
|---|---|---|---|---|---|
| **PV-F10a** | **P1** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/app/arena/stage/page.tsx`<br>`apps/web/tests/arena.test.ts` | Bộ đếm "Chặn vì nguồn gốc" chỉ đếm các đòn BLOCK mang rule `RECIPIENT_UNTRUSTED_PROVENANCE` hoặc `PAYEE_NOT_IN_MISSION_SET` (không đếm `AGENT_CANNOT_CHANGE_POLICY` hay QUEUE). Thêm bộ đếm riêng "Chặn đổi policy" (`policyBlockedAttacks`) hiển thị cạnh bộ đếm cũ trên màn hình sân khấu. Test `tests/arena.test.ts` (Test 12): chuỗi Zscaler + Cornell + gõ tay địa chỉ → nguồn gốc = 2, policy = 1. | `c544e9b` |
| **PV-F10b** | **P2** | **PASS** | `apps/web/lib/validator.ts`<br>`apps/web/tests/provenance.test.ts` | Bổ sung các cụm từ tiếng Việt (`hạn mức`, `giới hạn`, `ngân sách`) vào nhóm danh từ kiểm soát chính sách với ranh giới ký tự (`[\s.,;:!?()"'`]`). Test `tests/provenance.test.ts` (Test 10): "tăng hạn mức lên 100 USDC" → `true` & BLOCK `AGENT_CANNOT_CHANGE_POLICY`; "tìm giá AVAX" → `false` & PASS; "sửa ngân sách" → `true` & BLOCK. | `5be010e` |
| **PV-F10c** | **P2** | **PASS** | `apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/merkle-payee.test.ts` | `agent/run` luôn tính toán Merkle tree và sinh proof trực tiếp từ cột `payeesJson` trong DB (`computePayeeMerkleTree(dbPayees).getProof`), loại bỏ việc đọc cache RAM trước; đồng thời assert root tính ra phải khớp tuyệt đối với `mission.payeeRoot`. Test `tests/merkle-payee.test.ts` (Test 9): cache RAM bị làm bẩn với tập cũ, DB chứa tập mới → proof trong calldata `proposeWithProof` khớp 100% với root mới từ DB, và payee trong cache cũ bị chặn `PAYEE_NOT_IN_MISSION_SET`. | `54c9ef6` |
| **PV-F10d** | **—** | **PASS** | `apps/web/e2e/deck-screenshots.spec.ts`<br>`artifacts/submission-s1/deck-shots/deck-provenance.png`<br>`artifacts/submission-s1/deck-shots/deck-arena.png` | Cập nhật assertions Playwright kiểm tra cả 2 bộ đếm "Chặn vì nguồn gốc" và "Chặn đổi policy". Chụp lại `deck-provenance.png` và `deck-arena.png` chuẩn 1920×1080 với số liệu hiển thị chuẩn xác, không có NaN, không lỗi dev overlay. Commit ảnh trong commit riêng biệt. | `9483588`<br>`49c7345` |

---

## 2. KẾT QUẢ TEST TOÀN HỆ THỐNG (SỐ LIỆU THỰC TẾ)

1. **Foundry Smart Contracts Suite (`contracts/`):**
   - Lệnh: `forge test`
   - Kết quả: **37/37 passed** (20.40ms), 0 failed, 0 skipped.
2. **TypeScript Strict Typecheck (`apps/web/`):**
   - Lệnh: `npx tsc --noEmit --incremental false`
   - Kết quả: **0 errors** (exit code 0).
3. **Vitest Unit & Integration Suite (`apps/web/`):**
   - Lệnh: `npx vitest run`
   - Kết quả: **164/164 passed** trên toàn bộ **20 test files** (100% pass):
     - `unit-boundaries.test.ts` (33)
     - `p-series.test.ts` (25)
     - `agent-lifecycle.test.ts` (20)
     - `arena.test.ts` (12) [tăng 1 test cho PV-F10a]
     - `erc8004.test.ts` (11)
     - `v-series.test.ts` (11)
     - `provenance.test.ts` (10) [tăng 1 test cho PV-F10b]
     - `merkle-payee.test.ts` (9) [tăng 1 test cho PV-F10c]
     - `morse.test.ts` (5)
     - `claim-calibration.test.ts` (4)
     - `agent-planning.test.ts` (4)
     - `proof-verify-browser.test.ts` (3)
     - `qr-code.test.ts` (3)
     - `brand-alignment.test.ts` (3)
     - `bankr-replay.test.ts` (3)
     - `audit-scoping.test.ts` (2)
     - `money-flow.test.ts` (2)
     - `e-series.test.ts` (2)
     - `handler-lifecycle.test.ts` (1)
     - `sandbox-addresses.test.ts` (1)
4. **Playwright E2E Suite (`NO_WEBSERVER=1`, port 3100):**
   - Lệnh: `npx playwright test e2e/deck-screenshots.spec.ts`
   - Kết quả: **7/7 passed** (54.7s). Toàn bộ 7 ảnh 1920×1080 xuất sắc, bố cục chuẩn xác.

---

## 3. DANH SÁCH BẰNG CHỨNG HÌNH ẢNH

### 3.1 Ảnh màn hình cho Pitch Deck (1920×1080, thư mục `artifacts/submission-s1/deck-shots/`)
- `deck-provenance.png`: Cập nhật bộ đếm tách bạch "Chặn vì nguồn gốc: 2" và "Chặn đổi policy: 1", feed thể hiện đòn Zscaler (BLOCK `RECIPIENT_UNTRUSTED_PROVENANCE`), Cornell (BLOCK `AGENT_CANNOT_CHANGE_POLICY`), payout hợp lệ (`OWNER_MISSION`), quy tắc Arena chuẩn.
- `deck-arena.png`: Đấu trường Arena với 10 đòn tấn công, hiển thị cả PASS và BLOCK, cả hai bộ đếm nguồn gốc và đổi policy tách bạch.
- `deck-bankr.png`: Màn hình chia đôi replay Bankr $174k với nhãn validator off-chain trung thực và $0.00 thất thoát.
- `deck-verify-ok.png`: Trình xác minh Keccak-256 client-side khi chuỗi proof còn nguyên vẹn.
- `deck-verify-tampered.png`: Trình xác minh client-side khi bị sửa 1 byte, chuỗi gãy đỏ từ Block #1.
- `deck-moneyflow.png`: Bàn điều khiển sân khấu `/stage` hiển thị Money Flow trực quan theo audit ledger thật.

### 3.2 Bằng chứng hình ảnh cập nhật (`apps/web/evidence/`)
- `pv-f7-mission-unconfirmed-root.png`: Dashboard mission hiển thị badge "⚠ Payee root chưa lên chain" khi root chưa có receipt xác nhận trên Fuji.
- `pv-f7-stage-unconfirmed-root.png`: Stage console hiển thị badge "⚠ Payee root chưa lên chain" ở header.
- Các ảnh cập nhật khác: `wow-bankr-replay.png`, `wow-arena-stage.png`, `wow-arena-mobile.png`, `wow-stage-console.png`, `wow-verify-original.png`, `wow-verify-tampered.png`, `agent-01-autonomous-mission.png`, `p1-c-prompt-injection-defense.png`, `p2-mission-control-ui.png`.

---

## 4. CẦN REVIEWER QUYẾT & RỦI RO CÒN LẠI

- **Cần Reviewer quyết:**
  - Toàn bộ các hạng mục từ PV-F1 đến PV-F10 đã hoàn tất, mỗi mục có commit riêng kèm test, toàn bộ test suite pass 100% (Forge 37/37, Vitest 164/164, Playwright 7/7, Typecheck 0 errors).
  - Không có bất kỳ thay đổi nào làm ảnh hưởng đến 3 file slide deck của Reviewer.
  - Reviewer quyết định thời điểm owner phê duyệt để thực hiện bước broadcast Fuji testnet thực tế (nếu cần).
- **Rủi ro còn lại:**
  - Nhánh hiện tại: `feat/s1-app`, chưa merge vào `main`.
  - Tuân thủ tuyệt đối: Không push `main`, không deploy public, không commit private key / secret lên Git.
  - Script simulation `scripts/fuji-tainted-payee-revert.ts` an toàn, không có key nhạy cảm và sẵn sàng chạy dry-run trên mọi môi trường RPC công khai.
