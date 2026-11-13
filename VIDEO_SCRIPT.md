# MissionPay — Kịch Bản Video Demo (Round 13)

**Thời lượng:** ~1 phút 45 giây  
**Độ phân giải:** 1920×1080 (Full HD), 60fps  
**Phụ đề:** Tiếng Anh nhúng trực tiếp trên màn hình (`captions.srt`), khớp lời thoại `VOICEOVER.md`.  
**Nguyên tắc:** 100% bằng chứng đo lường thực tế on-chain Avalanche Fuji C-Chain.

---

## Danh Sách Cảnh Quay Thực Tế (Scene Order)

| # | Phân Cảnh | Thời Gian | Màn Hình / Thao Tác | Lời Thoại (Voiceover) | Chi Tiết Hiển Thị Trên Màn Hình |
|---|---|---|---|---|---|
| **S0** | **Twin Treasury Live trên Fuji** | 0:00–0:14 | `/arena/twin`: Cuộn xem bảng so sánh song song 2 mission | *"Here on Avalanche Fuji, our Twin Treasury shows the difference: a global allowlist drains funds, but MissionPay's mission guard reverts the attack on-chain."* | Badge xanh "CONFIRMED ON FUJI"; Cột trái (Mission A allowlist) mất +0.01 USDC; Cột phải (Mission B guard) revert `PayeeNotInMissionSet`, 0 USDC thoát; 2 link Snowtrace. |
| **S1** | **Chế Độ Giám Khảo: Tự Thử Nghiệm** | 0:14–0:34 | `/judge`: Nhập ví attacker ngẫu nhiên $\rightarrow$ Revert; thử ví Owner $\rightarrow$ Thành công | *"In Judge Mode, anyone can test this live: type any attacker address, and the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed."* | Nút "🎲 Random Attacker" $\rightarrow$ Thẻ đỏ `CONTRACT REVERTED: PayeeNotInMissionSet`; Nút "🛡️ Test Owner" $\rightarrow$ Thẻ xanh `CONTRACT ACCEPTED: Payout Authorized`; Lệnh `cast call`. |
| **S2** | **Đấu Trường Hack Ngân Quỹ (Bounty)** | 0:34–0:54 | `/bounty`: Gửi hóa đơn tấn công đánh lừa agent | *"In our public Bounty challenge, prompt injection completely tricks the autonomous agent, but our dual-layer guard stops the payout with zero dollars lost."* | Thẻ 1: Agent bị thuyết phục (LLM Tricked ✅); Thẻ 2: Guard chặn vì ngoài phạm vi; Thẻ 3: Hợp đồng revert `PayeeNotInMissionSet`; Bảo toàn $0.00 thất thoát. |
| **S3** | **Bằng Chứng On-Chain Snowtrace** | 0:54–1:08 | Snowtrace tx `0x0ad5...3e38` phóng to dòng revert reason | *"On Snowtrace, the live transaction receipt proves it: execution strictly reverted on-chain with the custom error PayeeNotInMissionSet."* | Dòng status: `0 (failed)`; Revert reason: `PayeeNotInMissionSet`; gasUsed: 60,000 gas. |
| **S4** | **Kiểm Toán Độc Lập Phía Trình Duyệt** | 1:08–1:28 | `/verify/demo-seed`: Điểm 100/100 ERC-8004 $\rightarrow$ Bấm sửa 1 byte $\rightarrow$ Chuỗi đỏ gãy | *"Every step is cryptographically anchored. Tampering with even a single byte instantly breaks the hash chain, turning the client-side verifier red."* | Chứng nhận ERC-8004 100/100; Bấm "TEST MODIFY 1 BYTE" lập tức chuyển đỏ `CORRUPTED / TAMPERED`; Bấm khôi phục chuyển xanh `VALID`. |
| **S5** | **Kết Luận & Kêu Gọi Hành Động** | 1:28–1:42 | Slide tổng kết + Thông tin repo và hợp đồng Fuji | *"LLMs can be fooled. Budgets on Avalanche can't. Sign the mission once, and the smart contract decides who gets paid."* | Dòng tiêu đề lớn: "LLMs can be fooled. Budgets on Avalanche can't."; Địa chỉ contract GuardedTreasury Fuji; Link GitHub repository. |

---

## File Đầu Ra Kèm Theo (Artifacts)
- `artifacts/submission-s1/video/raw-demo.webm`: Video gốc quay tự động qua Playwright (1920x1080).
- `artifacts/submission-s1/video/demo-silent.mp4`: Video chuẩn MP4 H.264 (1080p).
- `artifacts/submission-s1/video/captions.srt`: File phụ đề thời gian chuẩn khớp từng giây.
- `artifacts/submission-s1/video/VOICEOVER.md`: Lời đọc ngắn gọn 132 từ dành cho người thuyết trình.
- `artifacts/submission-s1/video/scenes.json`: Cấu hình danh sách phân cảnh và mốc thời gian.
