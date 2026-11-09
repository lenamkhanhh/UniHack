# OWNER_TODO: DANH MỤC CÔNG VIỆC CẦN OWNER DUYỆT & THỰC HIỆN

**Cập nhật:** 2026-11-09 11:25 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Milestone:** `M9 — Avalanche ICM Cross-L1 Mission Budgeting (Dispatch Testnet ↔ Fuji C-Chain)`

---

## 1. YÊU CẦU CẦN OWNER HỖ TRỢ TRƯỚC KHI BROADCAST M9 (DỪNG CHỜ OWNER)

Theo chỉ thị an toàn từ Reviewer và spec `PLAN_MAX_2026-11-08.md` Bước 0:  
> *"Nếu cần owner xin faucet → ghi rõ trong report và DỪNG chờ owner; trong lúc chờ, test bằng tmpnet/local hoặc dừng M9."*  
> *"M9 can faucet hay vi moi thi dung lai va ghi vao OWNER_TODO, khong tu tao vi, khong tieu Fuji vuot ngan sach 0.15 AVAX / 3 USDC. Khong copy gia tri .env vao code."*

### Hiện trạng kiểm tra Bước 0 (Dispatch L1):
1. **Dispatch RPC:** `https://subnets.avax.network/dispatch/testnet/rpc` — Hoạt động bình thường (Chain ID: `779672` / `0xbe598`).
2. **TeleporterMessenger:** Đã kiểm tra địa chỉ `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` trên cả 2 mạng:
   - **Fuji C-Chain:** Có bytecode (13,013 bytes).
   - **Dispatch Testnet:** Có bytecode (13,013 bytes).
3. **Số dư ví Owner & Agent trên Dispatch:**
   - Ví Owner (`0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`): **`0 wei` (0 DISPATCH)**.
   - Ví Agent (`0x374b8A126FDb9e5deEc8307da385076155Af3D72`): **`0 wei` (0 DISPATCH)**.

### Hành động cần Owner thực hiện:
- **Xin Faucet test token cho ví Owner trên Dispatch L1:**
  - Ví nhận: `0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`
  - Cổng Faucet: [Avalanche Core Testnet Faucet](https://core.app/tools/testnet-faucet/?subnet=dispatch) hoặc Builder Hub Faucet.
  - Số lượng cần: tối thiểu 0.5 - 1.0 DISPATCH token để đủ gas deploy contract `MissionSpendGateway` và phát sóng giao dịch ICM.
- **Sau khi nạp token:** Báo lại để Gemini tiến hành bước broadcast cross-chain Fuji ↔ Dispatch.

---

## 2. TIẾN ĐỘ THỰC HIỆN CỦA GEMINI TRONG LÚC CHỜ OWNER

Trong thời gian dừng chờ Owner nạp token gas Dispatch, Gemini thực hiện hoàn thiện:
1. **Hợp đồng `MissionSpendGateway.sol` & `MissionBudgetHub.sol`** (nằm tại `contracts/src/`).
2. **Foundry Unit Test Suite** sử dụng Mock Teleporter Messenger (`contracts/test/`) kiểm thử trọn vẹn logic cross-chain:
   - Request spend từ Dispatch L1 -> C-Chain kiểm tra Merkle payee root + cap.
   - Trả lời `approve` khi payee hợp lệ và số tiền trong ngân sách.
   - Trả lời `deny` khi payee ngoài root hoặc vượt ngân sách.
3. Không broadcast mạng thật, không tự tạo ví mới, không vượt ngân sách Fuji.
