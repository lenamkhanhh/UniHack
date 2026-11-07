# BẰNG CHỨNG GIAO DỊCH TRỰC TIẾP TRÊN AVALANCHE FUJI TESTNET (FUJI_EVIDENCE.md)

**Ngày cập nhật:** 2026-11-07T15:14:51.763Z | **Mạng:** Avalanche Fuji (Chain ID `43113`)  
**GuardedTreasury (Verified trên Snowtrace):** [`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)  
**Fuji Native USDC:** [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65)  
**ERC-8004 ReputationRegistry:** [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)  
**Owner Address (Builder Hub):** [`0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`](https://testnet.snowtrace.io/address/0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c)  
**Agent Address (Session Runner):** [`0x374b8A126FDb9e5deEc8307da385076155Af3D72`](https://testnet.snowtrace.io/address/0x374b8A126FDb9e5deEc8307da385076155Af3D72)  
**Session Wallet (Mission):** [`0xd97a60b954b91e96f5ed9d7c79c7dfcc43932a49`](https://testnet.snowtrace.io/address/0xd97a60b954b91e96f5ed9d7c79c7dfcc43932a49)  
**Seller Address (Tools):** [`0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB`](https://testnet.snowtrace.io/address/0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB)  

---

## 1. BẢNG TỔNG HỢP GIAO DỊCH ON-CHAIN TRÊN AVALANCHE FUJI

| Bước | Hành động | Kênh thực thi | Trạng thái | Block | Transaction Hash | Chi tiết kiểm chứng |
|---|---|---|---|---|---|---|
| **0a** | **Owner Funds Agent Gas** | Gọi trực tiếp contract | `SUCCESS` | `#60685221` | [`0x77b3774a...1261cc16`](https://testnet.snowtrace.io/tx/0x77b3774ae7af29c60daf63889ba53f4d939902bd32ac443e26c3b00a1261cc16) | Chuyển 0.05 AVAX từ Owner sang Agent để nạp gas khởi tạo |
| **0b** | **Owner Funds Treasury Capital** | Gọi trực tiếp contract | `SUCCESS` | `#60685225` | [`0x11690240...37d8e985`](https://testnet.snowtrace.io/tx/0x1169024035bb238f6b8cac1810ded7177d10be1d4767dba477575d9837d8e985) | Chuyển 3 Fuji USDC vốn hoạt động từ Owner sang GuardedTreasury |
| **1** | **Owner createMission** | Gọi trực tiếp contract | `SUCCESS` | `#60685230` | [`0x1785ad12...832a6a4f`](https://testnet.snowtrace.io/tx/0x1785ad129057934b1c44e41ae683112fd8a87b5cee1d0f6908f9cb50832a6a4f) | Khởi tạo mission 0xd63437f3... với hạn mức 2 USDC và agent 0x374b8A126FDb9e5deEc8307da385076155Af3D72 |
| **2** | **Owner setRecipient Allowlist** | Gọi trực tiếp contract | `SUCCESS` | `#60685231` | [`0x996da2c5...e8c69ba7`](https://testnet.snowtrace.io/tx/0x996da2c5c806280e2fae5d60c0bd230a344c4eed198dd77176e9421ae8c69ba7) | Allowlist contractor 0x1111111111111111111111111111111111111111 trong chính sách GuardedTreasury |
| **3a** | **Owner setMissionToolCap** | Gọi trực tiếp contract | `SUCCESS` | `#60685233` | [`0x80806d8a...dfa8f8a8`](https://testnet.snowtrace.io/tx/0x80806d8a61886056de9c5d9550af51b1f47225620cd1538d0cff48dedfa8f8a8) | Khóa trần tool cap on-chain 0.5 USDC cho mission trên contract |
| **3b** | **Owner fundMissionWallet** | Gọi trực tiếp contract | `SUCCESS` | `#60685234` | [`0x4eff5709...0e21b3ff`](https://testnet.snowtrace.io/tx/0x4eff5709f5e90beea93646484c6f3befe9805787619a2d3efc9e885b0e21b3ff) | Chuyển 0.5 USDC từ Treasury vào ví phiên hoạt động on-chain |
| **4** | **Owner setMissionPayeeRoot** | Gọi trực tiếp contract | `SUCCESS` | `#60685237` | [`0x842632c7...e0a8f186`](https://testnet.snowtrace.io/tx/0x842632c7bbb83e994f6616752fc558a55c115738625f1ce0a58b33b3e0a8f186) | Thiết lập Merkle root 0xc6ce8ae3... cho tập người nhận đã ký |
| **5** | **Agent x402 Tool Settlement (EIP-3009)** | Qua App API | `SUCCESS` | `#60686581` | [`0x15ea7467...411cb2f1`](https://testnet.snowtrace.io/tx/0x15ea74674877c2e40acc538d85b5da412c29ddefd44e4f0af2587ecc411cb2f1) | Ví phiên ký EIP-3009 qua App; Facilitator PayAI settle gasless tới seller 0xd4ce6B64... |
| **6** | **Agent proposeWithProof (Auto-Payout)** | Gọi trực tiếp contract | `SUCCESS` | `#60685448` | [`0x558ea384...bb990dd8`](https://testnet.snowtrace.io/tx/0x558ea384040d50ec01e18f6aba406fe6c43d383f3973ba66d065a3f8bb990dd8) | Giải ngân tự động 0.2 USDC cho contractor 0x11111111... với Merkle proof hợp lệ |
| **7** | **Attack Simulation: PayeeNotInMissionSet Revert** | Gọi trực tiếp contract | `REVERTED` | `#60685364` | [`0xc5f13e5d...fea4f1ff`](https://testnet.snowtrace.io/tx/0xc5f13e5d2986633182ba8d69d5560429b063c5bf5f871c6908962933fea4f1ff) | Giả lập server bị chiếm: gọi trực tiếp proposeWithProof tới người nhận ngoài Merkle set → REVERT thật |
| **8** | **Owner anchorMissionProof** | Gọi trực tiếp contract | `SUCCESS` | `#60686583` | [`0x6b3f0b59...41e1da6f`](https://testnet.snowtrace.io/tx/0x6b3f0b59cc3b47b4b8f25f44a845aef07f187d4a2f2b32cb9847b51541e1da6f) | Neo đỉnh chuỗi kiểm toán THẬT từ DB (0x1555bba9...) lên smart contract |
| **9** | **Owner ERC-8004 giveFeedback** | Gọi trực tiếp contract | `SUCCESS` | `#60685371` | [`0xeddde3d3...b0bc9105`](https://testnet.snowtrace.io/tx/0xeddde3d3cbc654996ad00c4945dc5790ae9c073b2e13181f92b477f9b0bc9105) | Ghi nhận danh tiếng on-chain (điểm 87, tag 'starred') trên registry ERC-8004 Fuji chính thức |

---

## 2. BẤT BIẾN AN TOÀN ĐÃ CHỨNG MINH THỰC TẾ TRÊN AVALANCHE FUJI

1. **Thanh toán x402 gasless thực tế qua Facilitator (Bước 5):**
   - Ví phiên ký ủy quyền `TransferWithAuthorization` (EIP-3009) qua App API.
   - Facilitator PayAI phát sóng giao dịch thanh toán lên Fuji (`from: 0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63`).
   - Agent và ví phiên trả **0 AVAX tiền gas**; thanh toán được chuyển đến `0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB`.
   - Trạng thái giao dịch được lưu vết trong cơ sở dữ liệu ở trạng thái `SETTLED`.

2. **Ngân sách khóa on-chain (Bước 3):**
   - Owner cấp 0.5 USDC từ GuardedTreasury vào ví phiên của nhiệm vụ.
   - Ví phiên không thể chi tiêu vượt quá số dư được cấp trên smart contract.

3. **Nguồn gốc người nhận (Provenance Merkle Set - Bước 4 & 6):**
   - Khoản thanh toán 0.2 USDC chỉ được thực hiện khi có Merkle proof hợp lệ khớp với `missionPayeeRoot` do Owner ký.

4. **Chặn tấn công on-chain (Bước 7 - REVERTED):**
   - Khi Agent bị chiếm quyền và gửi giao dịch chuyển tiền tới ví kẻ tấn công (`0xbad...bad`), smart contract `GuardedTreasury` **revert ngay lập tức với lỗi `PayeeNotInMissionSet`**, không một xu nào bị rút.

5. **Neo đỉnh chuỗi kiểm toán thật (Bước 8):**
   - Đỉnh băm chuỗi kiểm toán `0x1555bba98f065db80eb127dc0550fc1e30d4a01eb76e5395a0318ce0fa0b844a` được đọc trực tiếp từ cơ sở dữ liệu (`mission.auditHeadHash`) và neo bất biến lên smart contract `GuardedTreasury`.
   - Trang kiểm tra xác thực khớp hoàn toàn giữa chuỗi kiểm toán và dữ liệu on-chain.

6. **Danh tiếng ERC-8004 (Bước 9):**
   - Đánh giá phản hồi được ghi trực tiếp lên hợp đồng ReputationRegistry chính thức của Avalanche Fuji.
