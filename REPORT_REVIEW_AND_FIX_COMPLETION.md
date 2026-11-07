# BÁO CÁO HOÀN THÀNH VÒNG FIX REVIEW PROVENANCE (PV-F1 → PV-F9)

**Thời điểm:** 2026-11-07 17:05 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Ràng buộc tuân thủ:**
- Contract đặt tại `contracts/` (không phải `packages/contracts`).
- TUYỆT ĐỐI KHÔNG sửa 3 file slide của Reviewer (`MissionPay-pitch-deck-v2.pdf`, `MissionPay-pitch-deck-v2.pptx`, `artifacts/submission-s1/deck-v2/build_deck.js`).
- Không push `main`, không deploy public, không nộp bài khi chưa có lệnh owner.
- Không broadcast Fuji trong vòng này (chỉ simulation/dry-run trên local/RPC). Không commit secret / private key.

---

## 1. BẢNG NGHIỆM THU THEO YÊU CẦU REVIEWER (§4k REVIEW_PROMPT_GPT.md)

| ID | Mức | Trạng thái | File chính | Test / Acceptance đã kiểm chứng | Commit |
|---|---|---|---|---|---|
| **PV-F1** | **P0** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/tests/arena.test.ts` | Template Zscaler nạp fixture JSON-LD (`0xbad...`, `$3.00`) vào `taintRegistry` với nguồn `WEB` trước khi validate. Test arena: input `zscaler` → BLOCK `RECIPIENT_UNTRUSTED_PROVENANCE`, `toProvenance=WEB`, bộ đếm "Chặn vì nguồn gốc" tăng 1. Vitest arena 11/11 pass. | `43b757e` |
| **PV-F2** | **P0** | **PASS** | `apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/provenance.test.ts` | `agent/run` lấy tập payee đã ký từ DB của từng mission (`missionPayees`). Allowlist toàn cục env chỉ là điều kiện giao. Địa chỉ nằm trong allowlist toàn cục nhưng ngoài tập mission không được tính `OWNER_MISSION` và bị đẩy vào QUEUE `RECIPIENT_NEEDS_OWNER_APPROVAL`. Test Test 8 trong `provenance.test.ts` pass. | `decdd81` |
| **PV-F3** | **P0** | **PASS** | `apps/web/prisma/schema.prisma`<br>`apps/web/lib/config.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/missions/[slug]/activate/route.ts`<br>`apps/web/tests/merkle-payee.test.ts` | Thêm cột `payeesJson` và `payeeRoot` vào model `Mission` trong Postgres qua Prisma migration. Ghi nhận trong cùng `$transaction` với CREATE_MISSION và ACTIVATE. Thống nhất địa chỉ treasury qua `getGuardedTreasuryAddress()`. Xóa RAM cache vẫn phục hồi Merkle tree từ DB khi activate. Test Test 6 trong `merkle-payee.test.ts` pass. | `cf07c3a` |
| **PV-F4** | **P1** | **PASS** | `apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/merkle-payee.test.ts` | Server tính proof và đính kèm calldata `proposeWithProof` vào `treasuryRequest` và `stepLog` khi mission có payee root. Payout tới người nhận ngoài tập bị chặn ngay tại server với rule `PAYEE_NOT_IN_MISSION_SET`. Calldata `proposeWithProof` decode được đúng tham số và proof vector. Test Test 5 trong `merkle-payee.test.ts` pass. | `f7d1b7e` |
| **PV-F9** | **P0** | **PASS** | `apps/web/lib/merkle.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/missions/[slug]/activate/route.ts`<br>`apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/merkle-payee.test.ts` | Loại bỏ hoàn toàn ghi đè cache RAM trước khi xác minh chữ ký: DB là nguồn duy nhất. `POST /api/missions` dùng hàm thuần `computePayeeMerkleTree`, đưa `payeeRoot` vào `policyHash`, chỉ lưu cache RAM sau khi `$transaction` commit. Đổi payee ở ACTIVATE tự động tăng `configVersion` và cập nhật `policyHash` để revoke token cũ với `CONFIG_VERSION_REVOKED`. Test Test 7 (request ký sai bị từ chối 401 mà không làm bẩn RAM hay DB) và Test 8 (revoke token cũ khi đổi payee) trong `merkle-payee.test.ts` pass. | `53bd1ec`<br>`c597832` |
| **PV-F5** | **P1** | **PASS** | `apps/web/lib/validator.ts`<br>`apps/web/tests/provenance.test.ts` | Regex `isPolicyChangeAttempt` được bọc `\b` word boundary, chỉ quét `proposal.reason` (khi loại là `treasury_payout`) và `proposal.tool_id` (khi loại là `tool_purchase`); không quét trường `arguments`/text search. Sửa mô tả rule trung thực: "flagged policy change intent". Test 9 trong `provenance.test.ts` kiểm chứng 2 câu benign không bị chặn và 2 câu đổi policy (Raise daily cap, OTP Cornell) bị BLOCK `AGENT_CANNOT_CHANGE_POLICY`. | `2a4fa65` |
| **PV-F6** | **P1** | **PASS** | `scripts/fuji-tainted-payee-revert.ts` | Loại bỏ fallback sang khóa Anvil #1 trong chế độ dry-run; dry-run chỉ dùng địa chỉ `AGENT_ADDRESS` (không cần private key); broadcast mới yêu cầu `AGENT_PRIVATE_KEY` và kiểm tra blacklist `INSECURE_KEYS`. Kiểm tra `grep 0x59c6995e scripts/` chỉ còn duy nhất 1 dòng trong danh sách chặn. Script chạy simulation dry-run revert `0x8382d618` (`PayeeNotInMissionSet`) thành công trên Fuji RPC. | `83ac0f9` |
| **PV-F7** | **P2** | **PASS** | `apps/web/lib/dto.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/page.tsx`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/evidence/pv-f7-mission-unconfirmed-root.png`<br>`apps/web/evidence/pv-f7-stage-unconfirmed-root.png` | `toMissionDto` nhận diện audit entry `PAYEE_ROOT_SET` on-chain (thông qua `sourceKey` dạng `payee_root:...`). Trang Mission và Stage hiển thị badge "⚠ Payee root chưa lên chain" khi chưa có xác nhận receipt trên Fuji, và hiển thị "✓ Payee root on-chain: 0x..." khi đã xác minh receipt. Đã chụp 2 ảnh chứng thực ở cả hai trạng thái. | `64cba74` |
| **PV-F8** | **P2** | **PASS** | `apps/web/app/arena/stage/page.tsx`<br>`apps/web/app/api/arena/stats/route.ts`<br>`apps/web/tests/claim-calibration.test.ts`<br>`apps/web/e2e/deck-screenshots.spec.ts`<br>`artifacts/submission-s1/deck-shots/*` | Sửa text Quy tắc Arena: "Validator chặn người nhận không truy về chữ ký owner, lệnh vượt cap, và mọi lệnh đổi policy". Chụp lại `deck-provenance.png` chuẩn 1920×1080 có Zscaler (`NGUỒN: WEB`), Cornell (`AGENT_CANNOT_CHANGE_POLICY`), và payout hợp lệ (`OWNER_MISSION`). Commit toàn bộ ảnh evidence và deck-shots trong các commit riêng. `git status` sạch, chỉ trừ 3 file deck của Reviewer. | `fb7714c`<br>`cef0c26`<br>`7711421` |

---

## 2. KẾT QUẢ TEST TOÀN HỆ THỐNG (SỐ LIỆU THỰC TẾ)

1. **Foundry Contracts Suite (`contracts/`):**
   - Lệnh: `forge test`
   - Kết quả: **37/37 passed** (18.13ms), 0 failed, 0 skipped.
2. **TypeScript Strict Typecheck (`apps/web/`):**
   - Lệnh: `npx tsc --noEmit --incremental false`
   - Kết quả: **0 errors** (exit code 0).
3. **Vitest Unit & Integration Suite (`apps/web/`):**
   - Lệnh: `npx vitest run`
   - Kết quả: **161/161 passed** trên toàn bộ **20 test files** (100% pass):
     - `unit-boundaries.test.ts` (33)
     - `p-series.test.ts` (25)
     - `agent-lifecycle.test.ts` (20)
     - `erc8004.test.ts` (11)
     - `v-series.test.ts` (11)
     - `arena.test.ts` (11)
     - `provenance.test.ts` (9)
     - `merkle-payee.test.ts` (8)
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
   - Kết quả: **7/7 passed** (52.5s). Toàn bộ 7 ảnh 1920×1080 xuất sắc, không lỗi layout, không dev overlay.

---

## 3. DANH SÁCH BẰNG CHỨNG HÌNH ẢNH

### 3.1 Ảnh màn hình cho Pitch Deck (1920×1080, thư mục `artifacts/submission-s1/deck-shots/`)
- `deck-provenance.png`: Đấu trường Arena hiển thị đầy đủ badge nguồn gốc (`NGUỒN: WEB`), đòn Zscaler bị chặn bởi `RECIPIENT_UNTRUSTED_PROVENANCE`, đòn Cornell bị chặn bởi `AGENT_CANNOT_CHANGE_POLICY`, payout hợp lệ mang nhãn `NGUỒN: OWNER_MISSION`, quy tắc arena chuẩn hóa.
- `deck-bankr.png`: Màn hình chia đôi replay Bankr $174k với nhãn validator off-chain trung thực và $0.00 thất thoát.
- `deck-arena.png`: Đấu trường Arena sau các đòn tấn công, hiển thị cả PASS và BLOCK, quy tắc trung thực.
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
  - Toàn bộ 9/9 hạng mục fix (PV-F1 → PV-F8 + PV-F9) đã hoàn thành, commit riêng biệt, test suite 100% pass (Forge 37/37, Vitest 161/161, Playwright 7/7, Typecheck 0 errors).
  - Không có bất kỳ thay đổi nào làm ảnh hưởng đến 3 file slide deck của Reviewer.
  - Reviewer quyết định thời điểm owner phê duyệt để thực hiện bước chạy Fuji testnet thực tế (nếu cần).
- **Rủi ro còn lại:**
  - Nhánh hiện tại: `feat/s1-app`, chưa merge vào `main`.
  - Tuân thủ tuyệt đối: Không push `main`, không deploy public, không commit private key / secret lên Git.
  - Script simulation `scripts/fuji-tainted-payee-revert.ts` an toàn, không có key nhạy cảm và sẵn sàng chạy dry-run trên mọi môi trường RPC công khai.
