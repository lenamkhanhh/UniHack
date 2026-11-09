# OWNER_TODO: DANH MỤC CÔNG VIỆC CẦN OWNER DUYỆT & THỰC HIỆN

**Cập nhật:** 2026-11-09 11:25 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Milestone:** `M9 — Avalanche ICM Cross-L1 Mission Budgeting (Dispatch Testnet ↔ Fuji C-Chain)`

---

## 1. YÊU CẦU CẦN OWNER HỖ TRỢ TRƯỚC KHI BROADCAST M9 (DỪNG CHỜ OWNER)

Theo chỉ thị an toàn từ Reviewer và spec `PLAN_MAX_2026-11-08.md` Bước 0:  
> *"Nếu cần owner xin faucet → ghi rõ trong report và DỪNG chờ owner; trong lúc chờ, test bằng tmpnet/local hoặc dừng M9."*  
> *"M9 can faucet hay vi moi thi dung lai va ghi vao OWNER_TODO, khong tu tao vi, khong tieu Fuji vuot ngan sach 0.15 AVAX / 3 USDC. Khong copy gia tri .env vao code."*

### Hiện trạng kiểm tra Bước 0 (Dispatch L1 & Fuji C-Chain):
1. **Dispatch RPC:** `https://subnets.avax.network/dispatch/testnet/rpc` — Hoạt động bình thường (Chain ID: `779672` / `0xbe598`).
2. **TeleporterMessenger:** Đã kiểm tra địa chỉ `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` trên cả 2 mạng:
   - **Fuji C-Chain:** Có bytecode (13,013 bytes) — Blockchain ID: `0x7fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d5`.
   - **Dispatch Testnet:** Có bytecode (13,013 bytes) — Blockchain ID: `0x9f3be606497285d0ffbb5ac9ba24aa60346a9b1812479ed66cb329f394a4b1c7`.
3. **Số dư ví trên Dispatch L1 (cần Faucet):**
   - Ví Owner (`0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`): **`0 wei` (0 DISPATCH)** — Cần ~0.5 - 1.0 DISPATCH để deploy `MissionSpendGateway` và thực hiện kịch bản stranger spend.
   - Ví Agent (`0x374b8A126FDb9e5deEc8307da385076155Af3D72`): **`0 wei` (0 DISPATCH)** — Cần ~0.1 - 0.2 DISPATCH để gửi `sendSpendRequest` (Scenario 1: Authorized Agent Spend).
   - Ví Stranger: Có thể dùng luôn Ví Owner làm stranger hoặc ví test bất kỳ (~0.1 DISPATCH).

4. **Kế hoạch chi tiêu mạng Fuji C-Chain cho M9 (Nằm trong ngân sách an toàn):**
   - Deploy `MissionBudgetHub.sol`: ~1,164,540 gas ($\approx 0.029$ AVAX).
   - Cấu hình Hub (`setAllowedOrigin`, `registerMission`): ~150,000 gas ($\approx 0.004$ AVAX).
   - Nạp quỹ ban đầu cho Hub (`fundHub`): 1.00 USDC (hoặc $\le 1.00$ USDC).
   - **Tổng chi Fuji M9:** $\approx 0.033$ AVAX và $1.00$ USDC (Cam kết hoàn toàn nằm trong trần ngân sách cho phép: $\le 0.15$ AVAX và $\le 3.00$ USDC).

### Hành động cần Owner thực hiện:
- **Xin Faucet test token cho ví Owner và Agent trên Dispatch L1:**
  - Ví Owner nhận: `0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c` (~0.5 - 1.0 DISPATCH).
  - Ví Agent nhận: `0x374b8A126FDb9e5deEc8307da385076155Af3D72` (~0.1 - 0.2 DISPATCH).
  - Cổng Faucet: [Avalanche Core Testnet Faucet](https://core.app/tools/testnet-faucet/?subnet=dispatch) hoặc Builder Hub Faucet.
- **Sau khi nạp token:** Báo lại để Gemini tiến hành broadcast cross-chain Fuji ↔ Dispatch.

---

## 2. TIẾN ĐỘ THỰC HIỆN CỦA GEMINI TRONG LÚC CHỜ OWNER

Trong thời gian dừng chờ Owner nạp token gas Dispatch, Gemini thực hiện hoàn thiện:
1. **Hợp đồng `MissionSpendGateway.sol` & `MissionBudgetHub.sol`** (nằm tại `contracts/src/`).
2. **Foundry Unit Test Suite** sử dụng Mock Teleporter Messenger (`contracts/test/`) kiểm thử trọn vẹn logic cross-chain:
   - Request spend từ Dispatch L1 -> C-Chain kiểm tra Merkle payee root + cap.
   - Trả lời `approve` khi payee hợp lệ và số tiền trong ngân sách.
   - Trả lời `deny` khi payee ngoài root hoặc vượt ngân sách.
3. Không broadcast mạng thật, không tự tạo ví mới, không vượt ngân sách Fuji.


---

## 3. ĐÁNH GIÁ RỦI RO RELAYER DISPATCH → FUJI TESTNET (M9-F13)

- **Kết quả rà soát thực tế on-chain (Fuji C-Chain):**
  - Đã truy vấn hợp đồng `TeleporterMessenger` (`0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf`) trên mạng Fuji C-Chain trong hơn 50,000 blocks gần nhất (từ block `60,716,363` đến `60,766,363`).
  - **Số lượng log `ReceiveCrossChainMessage` từ Dispatch L1 (`sourceBlockchainID = 0x9f3be606...`):** **`0 log`**.
  - Giao dịch chuyển giao ICM gần nhất trên Fuji xảy ra tại block `60,634,577` (tx `0xd6306a82...`) từ một subnet khác (`0x6715...`), không phải Dispatch.
- **Rủi ro vận hành Live ICM:**
  - Trên mạng testnet công khai hiện tại, **không có relayer công cộng tự động phục vụ các tin nhắn Dispatch → Fuji với phí bằng 0 (`fee: 0`)**.
  - Nếu gửi tin nhắn cross-chain từ Dispatch, message sẽ được xếp hàng trong `TeleporterMessenger` của Dispatch nhưng sẽ **không tự động được phát sóng lên Fuji C-Chain** nếu không có relayer chuyển giao.
- **Phương án giải quyết khi Owner duyệt broadcast Live:**
  1. **Phương án A (Tự chạy relayer cục bộ):** Chạy công cụ `awm-relayer` của Avalanche CLI / Ava Labs trên máy local để theo dõi event trên Dispatch và chuyển giao sang Fuji C-Chain.
  2. **Phương án B (Relay thủ công qua chữ ký Warp):** Lấy chữ ký BLS/Warp của validators Dispatch từ RPC validator endpoint (`awm-signer`), sau đó dùng ví Owner hoặc Agent trên Fuji gọi trực tiếp `teleporterMessenger.receiveCrossChainMessage(...)`.
  3. **Phương án C (Cấu hình phí relayer):** Cấu hình `feeInfo` với token thưởng nếu phát hiện có relayer thương mại đang hoạt động.
