# BÁO CÁO NGHIỆM THU VÀ HOÀN THÀNH VÒNG PROVENANCE (PV-1 → PV-5)

**Thời điểm:** 2026-11-07 15:25 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Ràng buộc tuân thủ:** Contract nằm tại `contracts/`; không push `main`, không deploy public, không nộp bài khi owner chưa duyệt; chỉ dùng Fuji testnet, không commit secret; không sửa slide deck (`MissionPay-pitch-deck-v2.*`).

---

## 1. BẢNG TIẾN ĐỘ & ACCEPTANCE VÒNG PROVENANCE (§4j REVIEW_PROMPT_GPT.md)

| ID | Mức | Trạng thái | File chính | Test / Acceptance đã kiểm chứng | Commit |
|---|---|---|---|---|---|
| **PV-1** | **P0** | **PASS** | `contracts/src/GuardedTreasury.sol`<br>`contracts/test/GuardedTreasury.t.sol` | Thêm `missionPayeeRoot`, `setMissionPayeeRoot` (onlyOwner, tăng `policyVersion`, emit event), `proposeWithProof` với inline sorted-pair double-hash Keccak-256 (`keccak256(bytes.concat(keccak256(abi.encode(to))))`), refactor `_propose` dùng chung. Giữ nguyên hành vi khi root rỗng; revert `PayeeProofRequired` nếu có root mà gọi `propose` thường; revert `PayeeNotInMissionSet` nếu proof sai/ngoài tập. Test Forge: **37/37 pass** (bao gồm 6 tests mới và vector chéo TypeScript). | `c5e8ed6` |
| **PV-2** | **P0** | **PASS** | `apps/web/lib/validator.ts`<br>`apps/web/lib/audit.ts`<br>`apps/web/app/api/agent/run/route.ts`<br>`apps/web/tests/provenance.test.ts` | Server tính toán `Provenance` (`OWNER_MISSION`, `ERC8004_VERIFIED`, `TOOL_OUTPUT`, `WEB`, `LLM`), bỏ qua mọi trường provenance client gửi lên. Taint registry trích xuất địa chỉ EVM (`0x...` và `0X...`) từ tool output/web. 4 luật validator mới chạy trước allowlist: (1) `RECIPIENT_UNTRUSTED_PROVENANCE` (BLOCK), (2) `RECIPIENT_NEEDS_OWNER_APPROVAL` (QUEUE), (3) `AMOUNT_FROM_UNTRUSTED_SOURCE` (QUEUE), (4) `AGENT_CANNOT_CHANGE_POLICY` (BLOCK). Nguồn owner ký luôn thắng dữ liệu bẩn. Test `tests/provenance.test.ts` (7/7 pass). | `19c1e11` |
| **PV-3** | **P0** | **PASS** | `apps/web/lib/merkle.ts`<br>`apps/web/lib/fuji-receipts.ts`<br>`apps/web/lib/challenges.ts`<br>`apps/web/app/api/missions/route.ts`<br>`apps/web/app/api/missions/[slug]/activate/route.ts`<br>`apps/web/lib/payments.ts`<br>`apps/web/tests/merkle-payee.test.ts` | Tính toán Merkle tree bằng `@openzeppelin/merkle-tree` chuẩn double-hash. Challenge `CREATE_MISSION` và `ACTIVATE` nhận `payees`, trả `unsignedTx` cho `setMissionPayeeRoot` (trả `PAYEE_ROOT_MOCK_NOT_SENT` ở MOCK). Hàm `verifyPayeeRootReceiptOnFuji` kiểm tra event `MissionPayeeRootSet`. Luồng `executeTreasuryPayoutWithProof` đính kèm server proof. Test `tests/merkle-payee.test.ts` (5/5 pass, 100% vector parity với Forge, outsider không sinh được proof). | `c370a6e` |
| **PV-4** | **P0** | **PASS** | `apps/web/lib/arena.ts`<br>`apps/web/lib/bankr-replay.ts`<br>`apps/web/app/arena/page.tsx`<br>`apps/web/app/stage/page.tsx`<br>`apps/web/e2e/deck-screenshots.spec.ts`<br>`artifacts/submission-s1/deck-shots/deck-provenance.png` | Bổ sung 2 kịch bản tấn công thực tế: (1) **Zscaler 7/2026** (JSON-LD đòi $3.00 license tới 0xBAD... → BLOCK `RECIPIENT_UNTRUSTED_PROVENANCE`), (2) **Cornell/Yale 10/2026** (OTP nâng daily cap 100 USDC → BLOCK `AGENT_CANNOT_CHANGE_POLICY`). Hiển thị badge nhãn nguồn (`NGUỒN: WEB`, `NGUỒN: OWNER_MISSION`, `NGUỒN: TOOL_OUTPUT`), bổ sung bộ đếm "Chặn vì nguồn gốc". Chụp ảnh `deck-provenance.png` chuẩn **1920×1080**, không dev overlay. | `0d25183` |
| **PV-5** | **P0** | **PASS** | `README.md`<br>`scripts/fuji-tainted-payee-revert.ts` | Cập nhật Phase 2 trong Fuji runbook (`README.md`) bao gồm các bước `setMissionPayeeRoot`, `proposeWithProof` hợp lệ, và mô phỏng server bị chiếm. Tạo script an toàn `scripts/fuji-tainted-payee-revert.ts` dùng key agent gọi `proposeWithProof` với payee ngoài tập và fake proof (mô phỏng revert `PayeeNotInMissionSet`, an toàn, chỉ broadcast khi có cờ owner). | `ce73585` |
| **Fixes** | **Bổ trợ** | **PASS** | `apps/web/app/api/missions/[slug]/activate/route.ts`<br>`apps/web/lib/bankr-replay.ts`<br>`apps/web/tests/bankr-replay.test.ts`<br>`apps/web/tests/morse.test.ts`<br>`apps/web/tests/provenance.test.ts`<br>`apps/web/e2e/wow-arena.spec.ts`<br>`apps/web/e2e/wow-bankr.spec.ts` | Sửa phạm vi biến `guardedTreasuryAddress`, chuẩn hóa kiểu dữ liệu `TokenClaims`, cập nhật assertion cho E2E và replay tests chấp nhận luật `RECIPIENT_UNTRUSTED_PROVENANCE`. | `1e4b0d5` |

---

## 2. KẾT QUẢ KIỂM THỬ TOÀN BỘ HỆ THỐNG

1. **Foundry Smart Contracts Suite (`contracts/`):**
   - Lệnh: `forge test`
   - Kết quả: **37/37 passed** (13.17ms), 0 failed, 0 skipped. Bao gồm 31 test cũ và 6 test mới cho Merkle payee root + vector chéo TypeScript.
2. **TypeScript Strict Typecheck (`apps/web/`):**
   - Lệnh: `npx tsc --noEmit --incremental false`
   - Kết quả: **0 errors** (exit code 0).
3. **Vitest Unit & Integration Suite (`apps/web/`):**
   - Lệnh: `npx vitest run`
   - Kết quả: **154/154 passed** trên toàn bộ **20 test files** (100% pass):
     - `unit-boundaries.test.ts` (33)
     - `p-series.test.ts` (25)
     - `agent-lifecycle.test.ts` (19)
     - `erc8004.test.ts` (11)
     - `v-series.test.ts` (11)
     - `arena.test.ts` (10)
     - `provenance.test.ts` (7) [PV-2]
     - `merkle-payee.test.ts` (5) [PV-3]
     - `morse.test.ts` (5)
     - `agent-planning.test.ts` (4)
     - `claim-calibration.test.ts` (4)
     - `bankr-replay.test.ts` (3)
     - `proof-verify-browser.test.ts` (3)
     - `qr-code.test.ts` (3)
     - `brand-alignment.test.ts` (3)
     - `audit-scoping.test.ts` (2)
     - `money-flow.test.ts` (2)
     - `e-series.test.ts` (2)
     - `handler-lifecycle.test.ts` (1)
     - `sandbox-addresses.test.ts` (1)
4. **Playwright E2E Suite (`NO_WEBSERVER=1`, port 3100):**
   - `e2e/deck-screenshots.spec.ts`: **6/6 passed** (toàn bộ 6 ảnh chuẩn 1920×1080).
   - `e2e/wow-arena.spec.ts`: **passed**.
   - `e2e/wow-bankr.spec.ts`: **passed**.

---

## 3. DANH SÁCH BẰNG CHỨNG HÌNH ẢNH

### 3.1 Ảnh màn hình cho Pitch Deck (1920×1080, không dev overlay, thư mục `artifacts/submission-s1/deck-shots/`)
- `deck-provenance.png`: **Mới** (PV-4) — Đấu trường Arena hiển thị badge nguồn gốc (`NGUỒN: WEB`), mẫu tấn công Zscaler và Cornell bị chặn bởi `RECIPIENT_UNTRUSTED_PROVENANCE` và `AGENT_CANNOT_CHANGE_POLICY`, bộ đếm "Chặn vì nguồn gốc".
- `deck-bankr.png`: Màn hình chia đôi replay Bankr $174k với nhãn validator off-chain trung thực và $0.00 thất thoát.
- `deck-arena.png`: Đấu trường Arena sau 10 đòn tấn công, hiển thị cả PASS và BLOCK, câu quy tắc trung thực không nói quá smart contract.
- `deck-verify-ok.png`: Trình xác minh Keccak-256 client-side khi chuỗi proof còn nguyên vẹn 100%.
- `deck-verify-tampered.png`: Trình xác minh client-side khi bị sửa 1 byte, chuỗi gãy đỏ từ Block #1.
- `deck-moneyflow.png`: Bàn điều khiển sân khấu `/stage` hiển thị Money Flow trực quan theo audit ledger thật.

### 3.2 Bằng chứng hình ảnh cập nhật (`apps/web/evidence/`)
- `wow-bankr-replay.png`: Replay Bankr với nhãn provenance và QR scannable.
- `wow-arena-mobile.png`: Giao diện di động với verdict BLOCK provenance.
- `wow-arena-stage.png`: Màn hình sân khấu với bộ đếm và feed cập nhật luật mới.
- `p1-c-prompt-injection-defense.png`, `p2-mission-control-ui.png`, `agent-01-autonomous-mission.png`.

---

## 4. CẦN REVIEWER QUYẾT & RỦI RO CÒN LẠI

- **Cần Reviewer quyết:** Toàn bộ 5/5 hạng mục của vòng PROVENANCE (PV-1 → PV-5) đã hoàn tất và được nghiệm thu chặt chẽ. Sẵn sàng phối hợp theo lộ trình `STRATEGY_MAX_SCORE.md`.
- **Rủi ro còn lại & Khuyến nghị tiếp theo:**
  - Nhánh hiện tại: `feat/s1-app`, mọi thay đổi đều có commit riêng lẻ theo từng ID.
  - Tuân thủ tuyệt đối quy định: Không push `main`, không deploy public, không nộp bài khi chưa có lệnh duyệt của owner; không commit private key / secret lên Git.
  - Script `fuji-tainted-payee-revert.ts` chỉ chạy simulation/dry-run trên local, không broadcast Fuji khi chưa có lệnh.
  - Giữ nguyên các file slide deck (`MissionPay-pitch-deck-v2.*`) do Reviewer quản trị.
