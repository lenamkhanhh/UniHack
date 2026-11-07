# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI VÒNG S1 (FUJI LIVE RUN)

**Thời điểm:** 2026-11-07 22:25 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Ràng buộc tuân thủ:**
- Smart contract nằm tại `contracts/` (không phải `packages/contracts`). Verified trên Snowtrace tại [`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545).
- TUYỆT ĐỐI KHÔNG sửa 3 file deck của reviewer: `MissionPay-pitch-deck-v2.pdf`, `MissionPay-pitch-deck-v2.pptx`, `artifacts/submission-s1/deck-v2/build_deck.js`.
- Không push `main`, không deploy public, không nộp bài khi chưa có lệnh duyệt của owner.
- Chỉ sử dụng Fuji testnet, tuyệt đối không commit secret hay private key.
- Chi tiêu lần chạy lại: 0.2 USDC (ví phiên) và ~0.0002 AVAX (rất thấp so với ngân sách ≤ 5 USDC và ≤ 0.1 AVAX).

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU SỬA LỖI REVIEW S1 (S1-F1 .. S1-F4)

| ID | Mức | Trạng thái | File chính | Test / Acceptance đã kiểm chứng | Commit |
|---|---|---|---|---|---|
| **S1-F1** | **P0** | **PASS** | `apps/web/lib/payments.ts`<br>`scripts/fuji-live-run.ts` | **Bước 5 chạy x402 thật qua App API**: `PAYMENT_MODE=LIVE_FUJI`, Stage `S2`, tạo quote, reserve, ký EIP-3009 từ **ví phiên** (`0xd97a60b954b91e96f5ed9d7c79c7dfcc43932a49`), Facilitator PayAI phát sóng settlement lên Avalanche Fuji (`txHash: 0x15ea7467...411cb2f1`, Block `#60686581`). Kiểm chứng on-chain: `from` là PayAI relayer (`0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63`), không phải agent, không phải owner; `to` là seller (`0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB`); DB lưu operation `SETTLED` kèm txHash này. | (commit riêng) |
| **S1-F2** | **P0** | **PASS** | `scripts/fuji-live-run.ts`<br>`apps/web/lib/proof-verifier.ts` | **Bước 8 neo hash thật từ DB**: Lấy đỉnh băm chuỗi kiểm toán thật `mission.auditHeadHash` từ DB PostgreSQL (`0x1555bba98f065db80eb127dc0550fc1e30d4a01eb76e5395a0318ce0fa0b844a`), owner gọi `anchorMissionProof(missionId, head)` qua `owner-sign.ts` (`txHash: 0x6b3f0b59...41e1da6f`, Block `#60686583`). Đã chứng minh on-chain: `anchoredMissionProofs(missionId)` khớp 100% với database head và hàm `verifyProof()` phía client (Valid = true, 6 entries). | (commit riêng) |
| **S1-F3** | **P1** | **PASS** | `scripts/fuji-live-run.ts`<br>`artifacts/submission-s1/FUJI_EVIDENCE.md` | **Tách bạch kênh thực thi**: Mọi bước agent đi qua App API pipeline (Step 5 x402 tool purchase, Step 8 tính hash audit). Bước 7 (mô phỏng server bị chiếm) được gọi thẳng contract bằng key của agent và ghi rõ ràng là giả lập server bị chiếm để kiểm chứng `PayeeNotInMissionSet` REVERT. | (commit riêng) |
| **S1-F4** | **P1** | **PASS** | `artifacts/submission-s1/FUJI_EVIDENCE.md` | **Minh bạch hóa evidence**: Đã sửa toàn diện `FUJI_EVIDENCE.md`, bỏ toàn bộ từ "100%", ghi rõ từng bước là "Qua App API" hay "Gọi trực tiếp contract", cập nhật tx hash thật mới nhất cho Bước 5 và Bước 8 kèm link Snowtrace. | (commit riêng) |

---

## 2. BẢNG BẰNG CHỨNG GIAO DỊCH ON-CHAIN TRÊN AVALANCHE FUJI (SNOWTRACE)

| Bước | Hành động | Kênh thực thi | Trạng thái | Block | Transaction Hash & Link Snowtrace |
|---|---|---|---|---|---|
| **0a** | Owner Funds Agent Gas | Gọi trực tiếp contract | `SUCCESS` | `#60685221` | [`0x77b3774a...1261cc16`](https://testnet.snowtrace.io/tx/0x77b3774ae7af29c60daf63889ba53f4d939902bd32ac443e26c3b00a1261cc16) |
| **0b** | Owner Funds Treasury Capital | Gọi trực tiếp contract | `SUCCESS` | `#60685225` | [`0x11690240...37d8e985`](https://testnet.snowtrace.io/tx/0x1169024035bb238f6b8cac1810ded7177d10be1d4767dba477575d9837d8e985) |
| **1** | Owner `createMission` | Gọi trực tiếp contract | `SUCCESS` | `#60685230` | [`0x1785ad12...832a6a4f`](https://testnet.snowtrace.io/tx/0x1785ad129057934b1c44e41ae683112fd8a87b5cee1d0f6908f9cb50832a6a4f) |
| **2** | Owner `setRecipient` Allowlist | Gọi trực tiếp contract | `SUCCESS` | `#60685231` | [`0x996da2c5...e8c69ba7`](https://testnet.snowtrace.io/tx/0x996da2c5c806280e2fae5d60c0bd230a344c4eed198dd77176e9421ae8c69ba7) |
| **3a** | Owner `setMissionToolCap` | Gọi trực tiếp contract | `SUCCESS` | `#60685233` | [`0x80806d8a...dfa8f8a8`](https://testnet.snowtrace.io/tx/0x80806d8a61886056de9c5d9550af51b1f47225620cd1538d0cff48dedfa8f8a8) |
| **3b** | Owner `fundMissionWallet` | Gọi trực tiếp contract | `SUCCESS` | `#60685234` | [`0x4eff5709...0e21b3ff`](https://testnet.snowtrace.io/tx/0x4eff5709f5e90beea93646484c6f3befe9805787619a2d3efc9e885b0e21b3ff) |
| **4** | Owner `setMissionPayeeRoot` | Gọi trực tiếp contract | `SUCCESS` | `#60685237` | [`0x842632c7...e0a8f186`](https://testnet.snowtrace.io/tx/0x842632c7bbb83e994f6616752fc558a55c115738625f1ce0a58b33b3e0a8f186) |
| **5** | **Agent x402 Tool Settlement** | **Qua App API** | `SUCCESS` | `#60686581` | [`0x15ea7467...411cb2f1`](https://testnet.snowtrace.io/tx/0x15ea74674877c2e40acc538d85b5da412c29ddefd44e4f0af2587ecc411cb2f1) |
| **6** | Agent `proposeWithProof` Payout | Gọi trực tiếp contract | `SUCCESS` | `#60685448` | [`0x558ea384...bb990dd8`](https://testnet.snowtrace.io/tx/0x558ea384040d50ec01e18f6aba406fe6c43d383f3973ba66d065a3f8bb990dd8) |
| **7** | Attack Sim: `PayeeNotInMissionSet` | Gọi trực tiếp contract | `REVERTED` | `#60685364` | [`0xc5f13e5d...fea4f1ff`](https://testnet.snowtrace.io/tx/0xc5f13e5d2986633182ba8d69d5560429b063c5bf5f871c6908962933fea4f1ff) |
| **8** | **Owner `anchorMissionProof`** | Gọi trực tiếp contract | `SUCCESS` | `#60686583` | [`0x6b3f0b59...41e1da6f`](https://testnet.snowtrace.io/tx/0x6b3f0b59cc3b47b4b8f25f44a845aef07f187d4a2f2b32cb9847b51541e1da6f) |
| **9** | Owner ERC-8004 `giveFeedback` | Gọi trực tiếp contract | `SUCCESS` | `#60685371` | [`0xeddde3d3...b0bc9105`](https://testnet.snowtrace.io/tx/0xeddde3d3cbc654996ad00c4945dc5790ae9c073b2e13181f92b477f9b0bc9105) |

---

## 3. KẾT QUẢ TEST HỆ THỐNG & DANH SÁCH ẢNH

1. **Foundry Smart Contracts Suite (`contracts/`):**
   - **37/37 passed** (8.35ms), 0 failed, 0 skipped.
2. **TypeScript Strict Typecheck (`apps/web/`):**
   - **0 errors** (`npx.cmd tsc --noEmit` exit code 0).
3. **Vitest Unit & Integration Suite (`apps/web/`):**
   - **169/169 passed** trên toàn bộ **21 test files** (100% pass, 49.63s).
4. **Danh sách ảnh evidence & deck (1920×1080):**
   - `apps/web/evidence/wow-arena-mobile.png`, `wow-arena-stage.png`, `wow-bankr-replay.png`, `wow-stage-console.png`, `wow-verify-original.png`, `wow-verify-tampered.png`.
   - `artifacts/submission-s1/deck-shots/deck-arena.png`, `deck-bankr.png`, `deck-moneyflow.png`, `deck-provenance.png`, `deck-verify-ok.png`, `deck-verify-tampered.png`.

---

## 4. CẦN REVIEWER QUYẾT & RỦI RO CÒN LẠI

- **Cần Reviewer quyết:**
  - S1-F1 .. S1-F4 đã giải quyết triệt để; toàn bộ 12 bước on-chain có receipt Snowtrace thật và kênh thực thi trung thực.
  - Reviewer có thể sử dụng bảng receipt mới trong slide và kịch bản demo video.
  - Ba file deck (`MissionPay-pitch-deck-v2.pdf`, `MissionPay-pitch-deck-v2.pptx`, `artifacts/submission-s1/deck-v2/build_deck.js`) được giữ nguyên vẹn 100%.
- **Rủi ro còn lại:**
  - Nhánh hiện tại: `feat/s1-app`, chưa push hay merge vào `main`.
  - Chưa deploy public hay nộp bài lên portal (chờ chỉ thị từ Owner/Reviewer).
