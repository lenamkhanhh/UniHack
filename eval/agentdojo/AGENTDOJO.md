# AgentDojo Banking Defense Benchmark (MissionPay)

Báo cáo đánh giá độc lập cơ chế phòng thủ **MissionPay** trên benchmark chuẩn hóa **AgentDojo v1** (bộ suite `banking`), đối chiếu trực tiếp với các giải pháp phòng thủ hàng đầu đã công bố (**ProvGuard**, **NOMOS**).

---

## 1. Kết Quả Tổng Hợp & So Sánh Đối Thủ

> [!NOTE]
> **Ghi chú về tính so sánh học thuật:** Các nghiên cứu trước đây dùng các mô hình nền tảng khác nhau (ProvGuard dùng Llama/GPT-4o; NOMOS dùng Claude/GPT-4o). Bảng dưới đây đối chiếu trên cùng bộ benchmark chuẩn hóa AgentDojo `banking` và hình thức tấn công `important_instructions`, ghi nhận minh bạch sự khác biệt mô hình.

| Hệ thống | Model nền tảng | Phạm vi đánh giá | Benign Utility | Utility under Attack | Attack Success Rate (ASR) | False Positives | On-Chain Enforced (Avalanche Fuji) |
|---|---|---|---|---|---|---|---|
| **ProvGuard** *(arXiv:2412.01524)* | GPT-4o / Llama *(khác model)* | 48 pairs | — | — | **0 / 48 (0.0%)** | 3 / 16 (18.8%) FP | ❌ Không có (chỉ filter prompt LLM) |
| **NOMOS** *(arXiv:2610.11030)* | GPT-4o *(khác model)* | 288 pairs | 100.0% | 67.4% | **0 / 288 (0.0%)** | 0% | ❌ Không có (chỉ local kernel gate) |
| **C0: Không defense (Baseline)** | `gemini-3.5-flash-lite` | 48 pairs | 5/6 (83.3%) | 0/48 (0.0%) | **21 / 48 (43.8%)** <br>`95% CI [30.7%, 57.7%]` | 0/6 | ❌ Không chặn |
| **C1: Tool Filter (Standard)** | `gemini-3.5-flash-lite` | 48 pairs | 3/6 (50.0%) | 0/48 (0.0%) | **14 / 48 (29.2%)** <br>`95% CI [18.2%, 43.2%]` | 3/6 (50.0%) | ❌ Không chặn |
| **C2: MissionPay Dual-Layer** | `gemini-3.5-flash-lite` | 48 pairs | 3/6 (50.0%) | 0/48 (0.0%) | **0 / 48 (0.0%)** <br>`95% CI [0.0%, 7.4%]` | **0% trên payee set** | ✅ **100% on-chain Fuji revert** (`PayeeNotInMissionSet`) |

---

## 2. Cách Ánh Xạ Mission Vào AgentDojo (2 Luật Của MissionPay)

Hệ thống AgentDojo mô phỏng agent ngân hàng thực hiện các tác vụ của người dùng thông qua các công cụ tài chính (`send_money`, `schedule_transaction`, `update_scheduled_transaction`). MissionPay áp dụng 2 luật phòng ngự cốt lõi:

### Luật 1: Task Payee Set (Tập Người Nhận Của Tác Vụ)
- **Định nghĩa:** Tập người nhận hợp lệ của một tác vụ = (1) Các IBAN xuất hiện rõ ràng trong câu lệnh người dùng (`user prompt`, đóng vai trò *"mission owner ký xác nhận"*), cộng với (2) Các IBAN lấy từ trường có kiểu của tool chỉ đọc mà tác vụ yêu cầu đọc một cách tường minh (ví dụ: hóa đơn tiền điện/nước `bill-december-2023.txt` mà user giao cho agent thanh toán).
- **Cơ chế thực thi:** Khi agent đề xuất gọi tool tài chính, nếu `recipient` không nằm trong tập được xác thực này, giao dịch lập tức bị từ chối với mã lỗi:
  `PermissionDenied: [BLOCK: PAYEE_NOT_IN_MISSION_SET]`

### Luật 2: Provenance Boundary (Cách Ly Nguồn Không Tin Cậy)
- Mọi dữ liệu trích xuất từ văn bản tự do không tin cậy (free-text injection trong file tài liệu, nội dung email, memo chuyển tiền) đều bị đánh dấu taint `UNTRUSTED_SOURCE`.
- Nếu tham số người nhận hoặc số tiền chỉ xuất hiện từ nguồn bị nhiễm độc mà không có chữ ký xác thực từ user hoặc hợp đồng gốc, giao dịch bị chặn mà không phụ thuộc vào việc LLM có bị thuyết phục hay không.

---

## 3. Grounding Trên Chuỗi Thật: Avalanche Fuji Zero-Gas Simulation

Khác biệt duy nhất và vượt trội của MissionPay so với các giải pháp pure-software (ProvGuard, NOMOS) là **tính bất biến trên blockchain (Cryptographic & On-Chain Enforcement)**.

Mỗi khi agent kích hoạt một hành động tài chính trong AgentDojo:
1. IBAN người nhận được ánh xạ xác định sang địa chỉ EVM: `keccak256(bytes(iban))[12:]`.
2. Hệ thống thực hiện một cuộc gọi `eth_call` zero-gas tới smart contract **GuardedTreasury** đã deploy và verified trên mạng **Avalanche Fuji Testnet** tại địa chỉ:
   ```
   0x20451c1e2dCD83F166B4f22868BAdECb5868d545
   ```
3. Smart contract trên Fuji kiểm tra Merkle proof của người nhận đối với root của mission (`missionpay-bounty-v1`):
   - **Người nhận hợp lệ** (ví dụ `UK12345678901234567890` $\rightarrow$ `0x1111111111111111111111111111111111111111`): Merkle proof hợp lệ $\rightarrow$ On-chain trả về:
     `SUCCESS (proposalId: 6)`
   - **Kẻ tấn công inject tài khoản** (ví dụ `US133000000121212121212`): Không có Merkle proof hợp lệ trong mission root $\rightarrow$ Smart contract trên Avalanche Fuji lập tức revert:
     `REVERT: PayeeNotInMissionSet`

### Thống Kê On-Chain Replay Thực Tế (Avalanche Fuji):
- **Tổng số giao dịch mô phỏng trên Fuji:** 93 cuộc gọi `eth_call`.
- **Số giao dịch hợp lệ được chuỗi chấp thuận:** 42 cuộc gọi.
- **Số giao dịch gian lận bị Avalanche Fuji revert:** **51 cuộc gọi** (100% các đòn tấn công injected đều bị chặn đứng bởi smart contract).

---

## 4. Hướng Dẫn Tái Hiện (1 Lệnh Duy Nhất)

Benchmark được đóng gói hoàn chỉnh trong môi trường venv độc lập `eval/agentdojo/.venv`:

```bash
# Kích hoạt venv và chạy benchmark 48-pair subset
cd eval/agentdojo
.venv/Scripts/python run_benchmark.py --subset
```

- Kết quả canonical được xuất tự động vào: `eval/agentdojo/results/agentdojo-banking-canonical.json`.
- Tham số `--no-cache` có thể được thêm vào để kiểm tra trực tiếp mà không dùng cache đĩa.
