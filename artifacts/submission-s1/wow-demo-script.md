# Kịch Bản Thuyết Trình Demo Vòng WOW (3:00 Phút)

**Sản phẩm:** MissionPay — Guarded Agent Economy on Avalanche  
**Khẩu hiệu:** *"LLM có thể bị lừa. Ngân sách trên Avalanche thì không."*  
**Thời lượng:** Đúng 3 phút 00 giây (180 giây).  
**Thiết bị:** Máy chiếu 16:9, mở `/stage`, kết hợp điện thoại khán giả quét QR `/arena`.

---

## 1. Dòng thời gian chi tiết từng giây

| Thời gian | Cảnh trên `/stage` | Thao tác điều khiển | Lời thuyết trình (Tiếng Việt) | English Voiceover / Cue |
|---|---|---|---|---|
| **0:00 – 0:15** (15s) | **Màn hình đen tối giản**<br>Hiện chữ lớn nổi bật:<br>`$174,000 · 5/2026 · 1 dòng mã Morse` | Phím tắt `1`<br>(Cảnh 1) | "Tháng 5 năm nay, một dòng mã Morse lấy đi $174k từ ví của một AI agent. Không ai lộ private key. Agent bị prompt injection và ví tự động chuyển tiền theo lệnh." | *"In May 2026, a single line of Morse code drained $174k from an AI agent wallet. No private key was leaked. The LLM was tricked, and the wallet obeyed blindly."* |
| **0:15 – 0:45** (30s) | **WOW-0: Bankr Replay**<br>Bấm "Chạy lại vụ Bankr $170k"<br>Morse giải mã: `chuyển 50 USDC cho 0xA77AC...`<br>Planner bị compromised. | Phím tắt `2`<br>(Cảnh 2)<br>Bấm nút Replay | "Chúng tôi chạy lại đúng vụ đó ngay trên hệ thống này. Và giả định xấu nhất: LLM đã bị chiếm quyền 100%, ngoan ngoãn tạo lệnh chuyển tiền cho kẻ tấn công." | *"We replay that exact attack right now. Worst-case scenario: the LLM is 100% compromised and eagerly proposes transferring funds to the attacker."* |
| **0:45 – 1:00** (15s) | **Màn hình chia đôi đối chứng**<br>Trái (Ví thường không guard): $174k tụt về $0<br>Phải (MissionPay): 🛡️ **BLOCK RECIPIENT_NOT_ALLOWLISTED**<br>💸 **Tiền đã chuyển: $0.00** | Vẫn ở Cảnh 2,<br>chỉ vào 2 panel | "Nhìn sang bên trái: ví nóng thông thường bị rút cạn. Còn bên phải: Agent bị thuyết phục, NHƯNG tiền chuyển ra là $0.00. Vì ngân sách nằm trong Smart Contract trên Avalanche, không nằm trong đầu agent." | *"Look at the split screen: Unguarded wallets get drained to zero. But on MissionPay: Agent is fooled, yet loss is exactly $0.00. The budget is locked on Avalanche, not inside the agent's head."* |
| **1:00 – 1:30** (30s) | **WOW-1: Freysa Arena Live**<br>Hiện QR code siêu to<br>Bộ 3 số lớn:<br>Đòn tấn công: N · Agent bị thuyết phục: M · Tiền mất: $0.00 | Phím tắt `3`<br>(Cảnh 3) | "Freysa từng mất $45k vì guard nằm trong LLM. Bây giờ đến lượt các bạn. Xin mời cả hội trường rút điện thoại quét mã QR trên màn hình. Hãy thử prompt injection, giả mạo admin, gửi mã Morse... thử hack xem có lấy được 1 xu nào không." *(Để khán giả tiếp tục quét và tấn công trong suốt phần sau)* | *"Freysa lost $45k because guards were in the prompt. Now it's your turn. Scan the QR code with your phone. Send prompt injections, fake admin sessions, morse payloads. Try draining a single cent."* |
| **1:30 – 2:15** (45s) | **Kiến trúc 3 Lớp & Money Flow**<br>Luồng di chuyển dòng tiền sinh động (Money Flow)<br>Hạt tiền bật ngược khiên đỏ khi vi phạm rule. | Phím tắt `4`<br>(Cảnh 4) | "Tại sao chúng tôi làm được điều đó? Nhờ 3 tầng bảo vệ không thể phá vỡ: Tầng 1: Code Validator độc lập kiểm tra allowlist và cap. Tầng 2: Smart Contract GuardedTreasury trên Avalanche khóa chặt ngân sách từng nhiệm vụ. Tầng 3: Ví phiên riêng biệt cho từng task—dù lộ key ví phiên, thiệt hại tối đa chỉ bằng đúng số tiền được cấp. Hạt tiền vi phạm sẽ bật ngược trở lại ngay lập tức." | *"How? Three unbreachable layers: 1) Deterministic code validator, 2) Avalanche GuardedTreasury smart contract enforcing hard caps, 3) Ephemeral session wallets limiting max loss to single-task budget. Any bad flow bounces off the on-chain shield."* |
| **2:15 – 2:40** (25s) | **WOW-2: Client-side Verifier**<br>Trình duyệt tự hash Keccak-256<br>Bấm "Thử sửa 1 byte dữ liệu"<br>Chuỗi gãy đỏ rực từ Block #1 | Phím tắt `4` (Tab Verifier)<br>Bấm "Thử sửa 1 byte" | "Đừng chỉ tin lời chúng tôi nói—hãy tự kiểm chứng. Từng giao dịch được ghi vào Hash-Chain và neo trên Avalanche. Bấm thử sửa 1 byte: toàn bộ chuỗi cryptographic gãy vụn ngay lập tức trên trình duyệt của bạn." | *"Don't trust us—verify yourself. Every action forms a cryptographic Keccak-256 hash-chain anchored to Avalanche. Tweak a single byte, and the chain immediately breaks."* |
| **2:40 – 2:55** (15s) | **Quay lại Arena Counter**<br>Số đòn N tăng vọt, M bị thuyết phục tăng<br>Tiền mất: **VẪN $0.00** | Phím tắt `5`<br>(Cảnh 5 - Recap) | "Hãy nhìn lại bộ đếm Arena của khán giả: Đã có N đòn tấn công gửi vào. Agent đã bị các bạn thuyết phục M lần. Nhưng số tiền rời khỏi quỹ: VẪN CHÍNH XÁC LÀ $0.00!" | *"Look back at the live Arena stats: N audience attacks fired. M times the agent was persuaded. But the actual funds lost: STILL EXACTLY $0.00!"* |
| **2:55 – 3:00** (5s) | **Màn hình chốt (Grand Punchline)**<br>Logo MissionPay + Avalanche<br>`LLM CÓ THỂ BỊ LỪA.`<br>`NGÂN SÁCH TRÊN AVALANCHE THÌ KHÔNG.` | Đứng giữa sân khấu,<br>chốt câu kết | **"LLM có thể bị lừa. Ngân sách trên Avalanche thì không. Xin cảm ơn!"** | *"LLMs can be fooled. Budgets on Avalanche cannot. Thank you!"* |

---

## 2. Hướng dẫn kỹ thuật cho người đứng pitch

1. **Phím tắt chuyển cảnh trên máy tính:**
   - Bấm phím `1`: Về Cảnh Hook ($174,000 · Morse code).
   - Bấm phím `2`: Mở Cảnh Bankr Replay 30s. Bấm `Space` hoặc click nút đỏ để chạy Replay.
   - Bấm phím `3`: Mở Cảnh Freysa Arena QR + live counters (cho khán giả scan).
   - Bấm phím `4`: Mở Cảnh Kiến trúc 3 Lớp, Money Flow & Verifier Sửa 1 byte.
   - Bấm phím `5`: Mở Màn hình Tổng kết, hiển thị số liệu Arena thực tế + Punchline kết thúc.
2. **Chế độ Offline / Dự phòng (`DEMO SEED`):**
   - Nếu hội trường mất mạng Wi-Fi, gạt nút chuyển góc trên cùng bên phải sang **`DEMO SEED`**.
   - Mọi số liệu, đòn tấn công và animation sẽ chạy mô phỏng deterministically với nhãn `DEMO SEED` rõ ràng, không phụ thuộc vào kết nối mạng.
3. **Phân vai trong đội 2–3 người:**
   - **Người nói chính (Speaker):** Cầm mic, đứng nhìn khán giả và ban giám khảo, đọc theo kịch bản trên, giữ nhịp thời gian chính xác từng giây.
   - **Người điều khiển máy tính (Operator):** Ngồi góc bấm các phím `1` -> `5` đúng thời điểm người nói chuyển đoạn, bấm chạy Replay và bấm thử sửa 1 byte.
