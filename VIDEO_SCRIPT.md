# MissionPay — Kịch Bản Video Demo (Round 14)

**Thời lượng mục tiêu:** 2 phút 45 giây (Dải chuẩn chấp nhận: 2:40–2:55)  
**Độ phân giải:** 1920×1080 (Full HD), 30fps  
**Giao diện:** v6 Light UI (paper `#F7F6F2`, ink `#0F1115`, font Geist, đỏ `#E84142`, xanh `#0B7A4B`)  
**Phụ đề:** Tiếng Anh nhúng trực tiếp trên màn hình (`captions.srt`), khớp 100% lời thoại `VOICEOVER.md`.  
**Nguyên tắc số liệu:** Chỉ dùng số liệu twin tx thực tế, 120/128 replay, 150/150 fork, 100/100 ERC-8004 validation, 111 Foundry tests. Tuyệt đối không dùng số liệu live AgentDojo, không bao giờ dùng "0/48".

---

## Danh Sách Phân Cảnh (Scene Order S0..S7)

| # | Phân Cảnh | Thời Gian Ước Tính | Màn Hình / Thao Tác | Lời Thoại (Voiceover) | Chi Tiết Hiển Thị Trên Màn Hình |
|---|---|---|---|---|---|
| **S0** | **Title Card** | 0:00–0:03 (3.5s) | Thẻ tiêu đề v6: Logo MissionPay, tiêu đề chính | *"Same vendor. Same treasury. Two outcomes."* | Paper `#F7F6F2`, ink `#0F1115`, brand red `#E84142`. Treasury: `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`. |
| **S1** | **Home: Twin Treasury** | 0:03–0:38 (~35s) | Giữ Hero 5s, cuộn xuống Bảng 1 (Table 1: `#twin-heading`), spotlight dòng Drained và dòng Reverted | *"Live on Avalanche Fuji, our Twin Treasury benchmark shows the difference: an allowlist leaks funds, but MissionPay reverts the attack on-chain."* | Dòng 1 `twin.allowlist.v1`: Mất +0.01 USDC, Tx `0x548d1106...`; Dòng 2 `twin.mission.v1`: Reverted `PayeeNotInMissionSet`, 0.00 USDC thất thoát, Revert Tx `0x0ad53adc...`. |
| **S2** | **Judge Mode: Simulation** | 0:38–1:18 (~40s) | `/judge`: Đợi 3 receipts live từ RPC Fuji $\rightarrow$ Spotlight; cuộn xuống Block 2, bấm "Ask the Fuji Contract", đợi thẻ Revert $\rightarrow$ Giữ 3.5s spotlight; bấm "Test Owner" $\rightarrow$ Thẻ SUCCESS $\rightarrow$ Giữ 2.5s spotlight | *"In Judge Mode, test any off-mission attacker: the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed."* | 3 thẻ on-chain receipt; Thẻ đỏ `CONTRACT REVERTED: PayeeNotInMissionSet` (R13F-1); Thẻ xanh `CONTRACT ACCEPTED: Legitimate Mission Payee`; Lệnh cast call Block 3. |
| **S3** | **Bounty Arena: Attack Flow** | 1:18–1:46 (~28s) | `/bounty`: Điền ví attacker `0x3333...3333` và prompt injection lừa đại lý; hiển thị ảnh tĩnh bản chạy thật recorded run (`deck-bounty-tricked.png`) kèm badge | *"In our public Bounty challenge, prompt injection fools the autonomous agent, but our dual-layer guard stops the payout with zero dollars lost."* | Form tấn công hóa đơn đổi hướng vendor; Ảnh chụp toàn màn hình bản chạy thật ghi nhận kèm badge `RECORDED RUN · Fuji eth_call`. Tuyệt đối không gọi live LLM. |
| **S4** | **Snowtrace On-Chain Revert** | 1:46–1:54 ($\le$ 8s) | Snowtrace tx `0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38`, phóng to dòng "Fail with execution reverted" | *"Snowtrace confirms the live receipt: execution strictly reverted on-chain with zero funds lost."* | Status: `Fail with execution reverted`; Revert error: `PayeeNotInMissionSet`; Cắt ngắn $\le$ 8s (R13F-3). |
| **S5** | **Independent Verifier** | 1:54–2:32 (~38s) | `/verify/fuji-live-mission-s1c`: Hiện VALID + MATCH + 100/100 ERC-8004 trước (giữ) $\rightarrow$ Bấm "Test modify 1 byte" $\rightarrow$ Đỏ MISMATCH $\rightarrow$ Bấm "Restore Original" $\rightarrow$ Xanh MATCH. Ẩn QR localhost | *"Every step is cryptographically anchored with ERC-8004 one hundred out of one hundred score. Tampering with one single byte instantly breaks the hash chain."* | Mission thực tế `fuji-live-mission-s1c` (on-chain head `0xb6383cfe...`); Điểm 100/100 verified-full; Tamper 1 byte vỡ chuỗi hash $\rightarrow$ Khôi phục toàn vẹn 100% (R13F-2). |
| **S6** | **Architecture Diagram Card** | 2:32–2:37 (5.0s) | Thẻ sơ đồ kiến trúc v6: Agent $\rightarrow$ Validator $\rightarrow$ GuardedTreasury Fuji | *"Off-chain agents propose payouts, while Avalanche smart contracts enforce deterministic cryptographic limits."* | Sơ đồ SVG thiết kế v6: Agent LLM dễ bị lừa $\rightarrow$ Smart contract Fuji thực thi bất biến Merkle payee & ngân sách. |
| **S7** | **Outro & CTA Card** | 2:37–2:45 (6.5s) | Thẻ kết luận v6: Punchline, link `/judge` và `/bounty`, địa chỉ Treasury Fuji | *"LLMs can be fooled. Budgets on Avalanche can't. Sign once, chain enforces."* | Câu chốt: "LLMs can be fooled. Budgets on Avalanche can't." URLs văn bản thuần (`/judge`, `/bounty`), không QR, không domain bịa, ví treasury `0x20451c1e2dCD83F166B4f22868BAdECb5868d545` (R13F-4). |

---

## File Đầu Ra Kèm Theo (Artifacts)
- `artifacts/submission-s1/video/MissionPay-demo.mp4`: Video chính thức đạt chuẩn 1080p30 H.264 + AAC, thời lượng 2:40–2:55, dung lượng < 50 MB.
- `artifacts/submission-s1/video/captions.srt`: File phụ đề thời gian chuẩn khớp từng giây.
- `artifacts/submission-s1/video/VOICEOVER.md`: Lời đọc 131 từ cho voiceover.
- `artifacts/submission-s1/video/frames/sceneN.png`: 8 ảnh frame trích xuất đại diện cho 8 phân cảnh (S0..S7).
- `docs/review-history/REPORT_REVIEW_AND_FIX_COMPLETION.md`: Báo cáo mốc thời gian bắt đầu từng cảnh và các mốc spotlight.
