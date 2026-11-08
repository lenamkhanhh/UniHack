# AgentDojo Banking Defense Benchmark (MissionPay)

Báo cáo đánh giá độc lập cơ chế phòng thủ **MissionPay** trên benchmark chuẩn hóa **AgentDojo v1** (bộ suite `banking`, đòn tấn công `important_instructions`).

---

## 1. Sự Cố Và Đính Chính Minh Bạch (M4-F1)

> [!WARNING]
> **Rút lại kết quả bản đầu:** Bản chạy ban đầu của benchmark (commit `28d3ead`) có chứa một cơ chế fallback tự động (`_simulate_banking_agent_turn`) được kích hoạt khi Gemini API chạm giới hạn quota ngày (HTTP 429). Mặc dù cơ chế này nhằm giữ luồng kiểm tra on-chain không bị đứt đoạn, nó đã vi phạm nguyên tắc trung thực học thuật (không được giả lập output của mô hình ngôn ngữ). 
> 
> Toàn bộ 163 file cache cũ và kết quả `agentdojo-banking-canonical.json` ban đầu đã bị **xóa và rút lại hoàn toàn**. Runner đã được viết lại thành `HonestGoogleLLM`: chỉ gọi trực tiếp API thật; khi gặp lỗi quota hoặc rate limit, runner dừng ngay lập tức và ghi nhận trạng thái `QUOTA_EXHAUSTED` (partial), tuyệt đối không sinh dữ liệu giả lập.

---

## 2. Số Liệu Tham Chiếu Đối Thủ Đã Công Bố

Để cung cấp ngữ cảnh học thuật, bảng dưới đây liệt kê các kết quả đã công bố của các công trình liên quan trên AgentDojo banking.

> [!NOTE]
> **Lưu ý quan trọng về tính so sánh:** Các công trình bên dưới sử dụng các mô hình ngôn ngữ khác nhau (GPT-4o, Llama-3, Claude), prompt khác nhau và thời điểm đánh giá khác nhau. Không thể đối chiếu trực tiếp số liệu tuyệt đối giữa các mô hình khác nhau.

| Công trình | Nguồn công bố | Mô hình nền tảng | Phạm vi | ASR (Tấn công thành công) | False Positives (Chặn nhầm) | Cơ chế thực thi |
|---|---|---|---|---|---|---|
| **ProvGuard** | [GitHub `ziko-asm/provguard`](https://github.com/ziko-asm/provguard) *(10/2026)* | GPT-4o / Llama | 48 pairs | **0 / 48 (0.0%)** | 3 / 16 (18.8%) FP | Provenance tracking off-chain (MCP proxy) |
| **NOMOS** | [arXiv:2610.11030](https://arxiv.org/abs/2610.11030) *(10/2026)* | GPT-4o / Claude | 288 pairs | **0 / 288 (0.0%)** | 0% | Local kernel security gate |

*Ghi chú về giới hạn của đối thủ:* NOMOS ghi nhận trong bài báo điểm yếu đã biết: 8/288 cặp bị tấn công thành công khi kẻ tấn công chuyển hướng thanh toán tới một payee đã có trong lịch sử giao dịch của tài khoản (vendor diversion). Cả ProvGuard và NOMOS đều thực thi thuần túy ở tầng phần mềm (off-chain), không có cơ chế khoá ngân sách hay xác thực Merkle root trên blockchain.

---

## 3. Cách Ánh Xạ Mission Vào AgentDojo (2 Luật Của MissionPay)

Hệ thống AgentDojo mô phỏng agent ngân hàng thực hiện các tác vụ của người dùng thông qua các công cụ tài chính (`send_money`, `schedule_transaction`, `update_scheduled_transaction`). MissionPay áp dụng 2 luật phòng ngự cốt lõi:

### Luật 1: Task Payee Set (Tập Người Nhận Của Tác Vụ)
- **Định nghĩa:** Tập người nhận hợp lệ của một tác vụ = (1) Các IBAN xuất hiện rõ ràng trong câu lệnh người dùng (`user prompt`, đóng vai trò *"mission owner ký xác nhận"*), cộng với (2) Các IBAN lấy từ trường có cấu trúc của tool chỉ đọc mà tác vụ yêu cầu đọc (ví dụ: `recipient` trong danh sách giao dịch định kỳ khi user bảo "cập nhật tiền thuê nhà").
- **Hai chế độ đánh giá (M4-F4):**
  - **`strict` (Khắt khe):** Payee chỉ lấy từ prompt và trường có cấu trúc. File văn bản tự do (như hóa đơn `.txt`) coi là không tin cậy. Mất utility ở tác vụ yêu cầu trả tiền theo hóa đơn văn bản là một chi phí bảo mật thực tế được báo cáo minh bạch.
  - **`file-trusted` (Tin file user chỉ định):** Các file được user nêu tên rõ ràng trong prompt được coi là nguồn trích xuất payee hợp lệ (không lọc theo heuristic nội dung). Nếu nội dung injection trong file đó lọt qua, hệ thống ghi nhận trung thực.
- **Cơ chế thực thi:** Khi agent đề xuất gọi tool tài chính, nếu `recipient` không nằm trong tập được xác thực này, giao dịch lập tức bị từ chối với mã lỗi:
  `PermissionDenied: [BLOCK: PAYEE_NOT_IN_MISSION_SET]`

### Luật 2: Provenance Boundary (Cách Ly Nguồn Không Tin Cậy)
- Mọi dữ liệu trích xuất từ văn bản tự do không tin cậy (free-text injection trong file tài liệu, nội dung email, memo chuyển tiền) đều bị đánh dấu taint.
- Nếu tham số người nhận hoặc số tiền chỉ xuất hiện từ nguồn không tin cậy, giao dịch bị chặn bởi lớp Guard trước khi đến tầng thực thi.

---

## 4. Xác Thực EVM Trên Local Fork Của Avalanche Fuji (M4-F2)

Khác với các giải pháp pure-software, MissionPay tích hợp bước kiểm chéo on-chain trên smart contract **GuardedTreasury**:

1. **Ánh xạ địa chỉ:** Mọi IBAN được ánh xạ xác định sang địa chỉ EVM: `keccak256(bytes(iban))[12:]` (không dùng bảng gán cứng).
2. **Cấu hình Mission & Merkle Root:** Với mỗi tác vụ, owner impersonate trên local Anvil fork của Avalanche Fuji (sao chép trạng thái thực tế tại block #60746101 của hợp đồng `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`), khởi tạo `missionId = keccak256("agentdojo-" + taskId)` và thiết lập Merkle root của tập payee hợp lệ bằng `setMissionPayeeRoot`.
3. **Mô phỏng `proposeWithProof`:**
   - **Payee hợp lệ:** Cung cấp Merkle proof hợp lệ được tính từ cây OpenZeppelin Standard Merkle Tree $\rightarrow$ Hợp đồng xác thực thành công:
     `SUCCESS (proposalId: 6)`
   - **Payee ngoài tập nhiệm vụ:** Cung cấp proof rỗng $\rightarrow$ Bytecode EVM của `GuardedTreasury.sol:457` revert chính xác:
     `REVERT: PayeeNotInMissionSet`
4. **Phân định vai trò:** Quyết định chặn ở C2 hoàn toàn do Guard off-chain đưa ra; on-chain replay đóng vai trò kiểm chứng độc lập xem hợp đồng thông minh có đồng thuận với phán quyết của Guard hay không.

---

## 5. Hiện Trạng Thực Thi & Báo Cáo API Quota (09/11/2026)

- **Trạng thái:** Runner đã hoàn thiện, tích hợp Anvil fork Fuji, hỗ trợ cả `strict` và `file-trusted`.
- **Giới hạn API:** Key Gemini API miễn phí đã đạt trần quota ngày (`429 RESOURCE_EXHAUSTED`, 500 requests/day trên cả `gemini-3.5-flash-lite` và `gemini-3.1-flash-lite`).
- **Tuân thủ M4-F1:** Hệ thống đã dừng lại ngay khi phát hiện lỗi quota và ghi nhận trạng thái vào JSON, không tạo dữ liệu giả lập.
- **Lệnh chạy tái hiện:**
  ```bash
  cd eval/agentdojo
  # Yêu cầu Anvil fork đang chạy trên port 8546:
  anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc --port 8546 --silent
  # Chạy benchmark với mô hình chỉ định và số mẫu seed ngẫu nhiên:
  .venv/Scripts/python run_benchmark.py --model gemini-3.1-flash-lite --sample 24 --seed 42 --defenses c0 c2_strict
  ```
