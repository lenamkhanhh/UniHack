# BẰNG CHỨNG GIAO DỊCH TRỰC TIẾP TRÊN AVALANCHE FUJI TESTNET (FUJI_EVIDENCE.md)

**Ngày thực thi:** 2026-11-07 (Asia/Saigon) | **Mạng:** Avalanche Fuji (Chain ID `43113`)  
**GuardedTreasury (Verified on Snowtrace):** [`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)  
**Fuji Native USDC (Circle):** [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65)  
**ERC-8004 ReputationRegistry:** [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)  
**Owner Address (Builder Hub):** [`0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`](https://testnet.snowtrace.io/address/0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c)  
**Agent Address (Session Runner):** [`0x374b8A126FDb9e5deEc8307da385076155Af3D72`](https://testnet.snowtrace.io/address/0x374b8A126FDb9e5deEc8307da385076155Af3D72)  

---

## 1. BẢNG TỔNG HỢP GIAO DỊCH ON-CHAIN (100% REAL RECEIPTS ĐÃ KIỂM CHỨNG)

| Bước | Hành động | Trạng thái | Block | Transaction Hash | Chi tiết kiểm chứng |
|---|---|---|---|---|---|
| **0a** | **Owner Funds Agent Gas** | `SUCCESS` | `#60685221` | [`0x77b3774a...1261cc16`](https://testnet.snowtrace.io/tx/0x77b3774ae7af29c60daf63889ba53f4d939902bd32ac443e26c3b00a1261cc16) | Chuyển 0.05 AVAX từ Owner sang Agent để trả gas giao dịch on-chain |
| **0b** | **Owner Funds Treasury Capital** | `SUCCESS` | `#60685225` | [`0x11690240...37d8e985`](https://testnet.snowtrace.io/tx/0x1169024035bb238f6b8cac1810ded7177d10be1d4767dba477575d9837d8e985) | Chuyển 3 Fuji USDC vốn ban đầu từ Owner vào smart contract GuardedTreasury |
| **1** | **Owner createMission** | `SUCCESS` | `#60685230` | [`0x1785ad12...832a6a4f`](https://testnet.snowtrace.io/tx/0x1785ad129057934b1c44e41ae683112fd8a87b5cee1d0f6908f9cb50832a6a4f) | Tạo mission `0xd634...a9ed` với hạn mức 2 USDC và agent `0x374b8A...` |
| **2** | **Owner setRecipient Allowlist** | `SUCCESS` | `#60685231` | [`0x996da2c5...e8c69ba7`](https://testnet.snowtrace.io/tx/0x996da2c5c806280e2fae5d60c0bd230a344c4eed198dd77176e9421ae8c69ba7) | Cấp quyền allowlist cho địa chỉ contractor `0x1111111111111111111111111111111111111111` |
| **3a** | **Owner setMissionToolCap** | `SUCCESS` | `#60685233` | [`0x80806d8a...dfa8f8a8`](https://testnet.snowtrace.io/tx/0x80806d8a61886056de9c5d9550af51b1f47225620cd1538d0cff48dedfa8f8a8) | Khóa ngân sách tool tối đa 0.5 USDC cho mission |
| **3b** | **Owner fundMissionWallet** | `SUCCESS` | `#60685234` | [`0x4eff5709...0e21b3ff`](https://testnet.snowtrace.io/tx/0x4eff5709f5e90beea93646484c6f3befe9805787619a2d3efc9e885b0e21b3ff) | Cấp 0.5 USDC từ Treasury vào ví phiên Agent on-chain |
| **4** | **Owner setMissionPayeeRoot** | `SUCCESS` | `#60685237` | [`0x842632c7...e0a8f186`](https://testnet.snowtrace.io/tx/0x842632c7bbb83e994f6616752fc558a55c115738625f1ce0a58b33b3e0a8f186) | Thiết lập Merkle root `0xc6ce8a...` bảo đảm nguồn gốc người nhận theo mission |
| **5** | **Agent x402 Tool Settlement** | `SUCCESS` | `#60685359` | [`0x58d5390c...18d05d9c`](https://testnet.snowtrace.io/tx/0x58d5390c45d4df69453e4cda71739306acb19ff8cd538589e6fe2f5418d05d9c) | Giao dịch EIP-3009 transferWithAuthorization thanh toán tool 0.01 USDC trên Fuji USDC |
| **6** | **Agent proposeWithProof (Auto-Payout)** | `SUCCESS` | `#60685448` | [`0x558ea384...bb990dd8`](https://testnet.snowtrace.io/tx/0x558ea384040d50ec01e18f6aba406fe6c43d383f3973ba66d065a3f8bb990dd8) | Giải ngân tự động 0.2 USDC từ Treasury tới contractor với Merkle proof hợp lệ |
| **7** | **Attack Simulation (PayeeNotInMissionSet)** | `REVERTED` | `#60685364` | [`0xc5f13e5d...fea4f1ff`](https://testnet.snowtrace.io/tx/0xc5f13e5d2986633182ba8d69d5560429b063c5bf5f871c6908962933fea4f1ff) | Giao dịch revert thật trên Fuji chứng minh contract chặn đứng kẻ tấn công rút tiền ngoài Merkle set |
| **8** | **Owner anchorMissionProof** | `SUCCESS` | `#60685370` | [`0x47f318f8...375cbea3`](https://testnet.snowtrace.io/tx/0x47f318f816b8fc94e250d5bddefdb6d86a03cbc154e61b2b6e752825375cbea3) | Neo giá trị băm đỉnh chuỗi kiểm toán (audit chain head hash) vĩnh viễn trên smart contract |
| **9** | **Owner ERC-8004 giveFeedback** | `SUCCESS` | `#60685371` | [`0xeddde3d3...b0bc9105`](https://testnet.snowtrace.io/tx/0xeddde3d3cbc654996ad00c4945dc5790ae9c073b2e13181f92b477f9b0bc9105) | Ghi nhận danh tiếng cho Agent (điểm 87, tag 'starred') trên ReputationRegistry chuẩn ERC-8004 Fuji |

---

## 2. BẤT BIẾN AN TOÀN ĐÃ ĐƯỢC CHỨNG MINH THỰC TẾ TRÊN AVALANCHE FUJI

1. **Ngân sách khóa on-chain (Bước 3):** Owner cấp đúng 0.5 USDC từ Treasury vào ví phiên Agent. Agent không thể tiêu vượt quá số dư ví phiên.
2. **Nguồn gốc người nhận (Provenance Merkle Set - Bước 4 & 6):** Khoản thanh toán 0.2 USDC chỉ được thực hiện khi có Merkle proof hợp lệ khớp với `missionPayeeRoot` do Owner ký (`0x558ea384...bb990dd8`).
3. **Chặn tấn công on-chain (Bước 7 - REVERTED):** Khi Agent bị chiếm quyền và gửi giao dịch chuyển tiền tới ví kẻ tấn công (`0xbad...bad`), smart contract `GuardedTreasury` **revert ngay lập tức với lỗi `PayeeNotInMissionSet`** (`0xc5f13e5d...fea4f1ff`), không một xu nào bị rút.
4. **Biên lai kiểm chứng và danh tiếng (Bước 8 & 9):** Proof hash được neo bất biến vào smart contract (`0x47f318f8...375cbea3`), và feedback danh tiếng được ghi trực tiếp lên hợp đồng ERC-8004 chính thức của Avalanche Fuji (`0xeddde3d3...b0bc9105`).
