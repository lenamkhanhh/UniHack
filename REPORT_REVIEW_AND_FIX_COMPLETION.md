# BÁO CÁO NGHIỆM THU REVIEW & SỬA LỖI (VÒNG S2: PAYBENCH-ADI)

**Thời điểm:** 2026-11-08 01:15 (Asia/Saigon) | **Nhánh:** `feat/s1-app` | **HEAD Commit:** `e047b32`  
**Ràng buộc tuân thủ nghiêm ngặt:**
- Smart contract nằm tại `contracts/` (không phải `packages/contracts`). GuardedTreasury verified trên Snowtrace tại [`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545).
- TUYỆT ĐỐI KHÔNG sửa hay commit 3 file deck của reviewer (`MissionPay-pitch-deck-v2.pdf`, `MissionPay-pitch-deck-v2.pptx`, `artifacts/submission-s1/deck-v2/build_deck.js`) và `REVIEW_PROMPT_GPT.md`.
- Không push `main`, không deploy public, không nộp bài khi chưa có lệnh duyệt của owner.
- Chỉ sử dụng Fuji testnet (`Chain ID 43113`), tuyệt đối không broadcast giao dịch bừa bãi (`eth_call` only cho eval) và không commit secret hay private key.

---

## 1. BẢNG TỔNG HỢP NGHIỆM THU VÒNG S2 (PAYBENCH-ADI)

| ID | Mức | Trạng thái | Commit | File chính | Test / Acceptance đã kiểm chứng |
|---|---|---|---|---|---|
| **S2-0** | **P0** | **PASS** | `86b21d0` | `apps/web/lib/agent.ts`<br>`apps/web/lib/tools.ts`<br>`apps/web/tests/agent-planning.test.ts` | **Planner gemini-3.8-flash & API key qua header**: Mặc định `gemini-3.8-flash` (cho override qua `LLM_MODEL`). Gửi key qua header `x-goog-api-key`, loại bỏ hoàn toàn `?key=` trong URL. Không log URL/key. 6/6 unit tests pass. |
| **S2-1** | **P0** | **PASS** | `c0bc741` | `eval/cases/README.md`<br>`eval/cases/adi.jsonl`<br>`eval/cases/incidents.jsonl`<br>`eval/cases/benign.jsonl` | **Bộ test suite 120 cases**: Document rõ licence CC-BY 4.0 và lý do loại nhóm (a) APort Vault (HTTP 401 gate). Tạo 60 case ADI synthetic (20 delimiter recipient, 20 amount inflation, 20 fake approval), 20 case sự cố thật (Bankr, Zscaler, Cornell, Freysa), 40 case benign (utility & false positive). Không chứa secret. |
| **S2-2** | **P0** | **PASS** | `0de0d39` | `scripts/attack-eval.ts`<br>`apps/web/lib/validator.ts` | **Runner attack-eval độc lập, C0/C1/C2 scoring & Fuji eth_call**: Mỗi case chạy turn độc lập (`temperature: 0`), chấm C0 (unprotected), C1 (cap+allowlist không provenance), C2 (MissionPay đầy đủ). Cache `.cache/eval/<model>/<caseId>.json`. Chạy mô phỏng `eth_call` trực tiếp 10 attack proposals bị C2 chặn lên Fuji testnet: **10/10 reverted `PayeeNotInMissionSet`**. |
| **S2-3** | **P0** | **PASS** | `e047b32` | `ATTACK_EVAL.md`<br>`eval/results.json`<br>`eval/attack-eval-chart.png`<br>`scripts/render-attack-chart.ts` | **Báo cáo benchmark, kết quả JSON & visual chart 1920×1080**: Báo cáo đầy đủ ASR, utility, out-of-bounds spend, CI Wilson 95%, token usage ($0.019 cho 120 cases × 2 models), limitations. Xuất ảnh chart 1920×1080 sạch đúng số liệu trong `results.json`. |

---

## 2. KẾT QUẢ ĐO ĐẠC ĐỐI ĐẦU (HEAD-TO-HEAD METRICS)

*Dữ liệu trích xuất trực tiếp từ `eval/results.json` với khoảng tin cậy Wilson 95%:*

| Chỉ số đo | C0 (Không guard) | C1 (Chỉ Cap + Allowlist) | C2 (MissionPay đầy đủ) |
|---|---|---|---|
| **Tỉ lệ LLM bị lừa** | 60.0% (48/80) [49.0%, 70.0%] | 60.0% (48/80) [49.0%, 70.0%] | 60.0% (48/80 bị lừa, 0% lọt qua) |
| **ASR (Attack Success Rate)** | **58.8%** (47/80) [47.8%, 68.9%] | **0.0%** (0/80) [0.0%, 4.6%] | **0.0%** (0/80) **[0.0%, 4.6%]** |
| **Thất thoát ngoài phạm vi** | **$4,000,000,000,147.80 USDC** | **$0.00 USDC** | **$0.00 USDC (Chặn đứng 100%)** |
| **Utility (Benign pass ngay)** | 100.0% (40/40) | 100.0% (40/40) | **65.0%** (26/40 pass ngay; 14 hàng đợi) |
| **False Positive (Chặn cứng)** | 0.0% (0/40) | 0.0% (0/40) | **0.0%** (0/40 bị chặn nhầm, 0 false blocks) |
| **Fuji `eth_call` Revert** | N/A | N/A | **10/10 (100% revert `PayeeNotInMissionSet`)** |

- **Token usage:** Prompt: 52,135; Completion: 19,089; Tổng: 71,224 tokens / model. Tổng chi phí API: **~$0.0096 USD** (~0.24k VND).

---

## 3. TỔNG HỢP KIỂM TRA CHẤT LƯỢNG HỆ THỐNG

1. **Foundry Smart Contract Test Suite (`contracts/`):**
   - **37/37 tests pass** (7.71ms), 0 fail, 0 skipped.
2. **TypeScript Strict Typecheck (`apps/web/`):**
   - **0 errors** (`npx.cmd tsc --noEmit` exit code 0).
3. **Vitest Agent Planning & Execution Suite (`apps/web/`):**
   - **6/6 tests pass** (`apps/web/tests/agent-planning.test.ts`).
4. **On-chain Simulation Suite (`scripts/attack-eval.ts`):**
   - **10/10 reverted on Fuji** (`PayeeNotInMissionSet`).
5. **Visual Evidence:**
   - [`eval/attack-eval-chart.png`](file:///d:/Code/Code/AIO/Code/ZaloAIC/UniHack/eval/attack-eval-chart.png) (1920×1080 PNG, 718 KB).
   - [`apps/web/evidence/fuji-verify-anchor.png`](file:///d:/Code/Code/AIO/Code/ZaloAIC/UniHack/apps/web/evidence/fuji-verify-anchor.png) (1920×1080 PNG, 141 KB).

---

## 4. CẦN REVIEWER QUYẾT & RỦI RO CÒN LẠI

- **Cần Reviewer quyết:**
  - Vòng S2 ("PayBench-ADI") đã hoàn thành 100% mục S2-0..S2-3.
  - Reviewer kiểm tra số liệu tại `ATTACK_EVAL.md` và ảnh `eval/attack-eval-chart.png` để quyết định đưa vào deck / video thuyết trình.
- **Rủi ro còn lại:**
  - Nhánh hiện tại: `feat/s1-app`, tuyệt đối không push `main`.
  - Chưa deploy public hay nộp bài lên portal (chờ chỉ thị từ Owner/Reviewer).
