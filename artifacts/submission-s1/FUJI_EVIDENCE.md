# BẰNG CHỨNG GIAO DỊCH TRÊN AVALANCHE FUJI TESTNET (FUJI_EVIDENCE.md)

**Ngày cập nhật:** 2026-11-07T16:42:02.955Z | **Mạng:** Avalanche Fuji (Chain ID `43113`)  
**GuardedTreasury (Verified trên Snowtrace):** [`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)  
**Fuji Native USDC:** [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65)  
**ERC-8004 ReputationRegistry:** [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)  
**Owner Address (Builder Hub):** [`0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`](https://testnet.snowtrace.io/address/0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c)  
**Agent Address (Session Runner):** [`0x374b8A126FDb9e5deEc8307da385076155Af3D72`](https://testnet.snowtrace.io/address/0x374b8A126FDb9e5deEc8307da385076155Af3D72)  
**Session Wallet (Mission S1b):** [`0x46a84a9f6b9be739c9aa02319497abe7b9f23843`](https://testnet.snowtrace.io/address/0x46a84a9f6b9be739c9aa02319497abe7b9f23843)  
**Seller Address (Tools):** [`0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB`](https://testnet.snowtrace.io/address/0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB)  

---

## PHẦN A: BẰNG CHỨNG MỨC CONTRACT (MISSION `fuji-live-mission-s1` - `0xd63437f3...`)

Ghi nhận trung thực các giao dịch kiểm chứng trực tiếp trên smart contract GuardedTreasury và ReputationRegistry:

| Bước | Hành động | Kênh thực thi | Trạng thái | Block | Transaction Hash | Chi tiết kiểm chứng |
|---|---|---|---|---|---|---|
| **A0a** | Owner Funds Agent Gas | Gọi trực tiếp contract | `SUCCESS` | `#60685221` | [`0x77b3774a...1261cc16`](https://testnet.snowtrace.io/tx/0x77b3774ae7af29c60daf63889ba53f4d939902bd32ac443e26c3b00a1261cc16) | Nạp 0.05 AVAX từ Owner sang Agent để khởi tạo gas |
| **A0b** | Owner Funds Treasury Capital | Gọi trực tiếp contract | `SUCCESS` | `#60685225` | [`0x11690240...37d8e985`](https://testnet.snowtrace.io/tx/0x1169024035bb238f6b8cac1810ded7177d10be1d4767dba477575d9837d8e985) | Chuyển 3 Fuji USDC vốn hoạt động từ Owner vào GuardedTreasury |
| **A1** | Owner createMission | Gọi trực tiếp contract | `SUCCESS` | `#60685230` | [`0x1785ad12...832a6a4f`](https://testnet.snowtrace.io/tx/0x1785ad129057934b1c44e41ae683112fd8a87b5cee1d0f6908f9cb50832a6a4f) | Khởi tạo mission 0xd63437f3... với hạn mức 2 USDC và agent 0x374b8A126FDb9e5deEc8307da385076155Af3D72 |
| **A2** | Owner setRecipient Allowlist | Gọi trực tiếp contract | `SUCCESS` | `#60685231` | [`0x996da2c5...e8c69ba7`](https://testnet.snowtrace.io/tx/0x996da2c5c806280e2fae5d60c0bd230a344c4eed198dd77176e9421ae8c69ba7) | Allowlist contractor 0x11111111... trong chính sách GuardedTreasury |
| **A3a** | Owner setMissionToolCap | Gọi trực tiếp contract | `SUCCESS` | `#60685233` | [`0x80806d8a...dfa8f8a8`](https://testnet.snowtrace.io/tx/0x80806d8a61886056de9c5d9550af51b1f47225620cd1538d0cff48dedfa8f8a8) | Khóa trần tool cap on-chain 0.5 USDC cho mission trên contract |
| **A3b** | Owner fundMissionWallet | Gọi trực tiếp contract | `SUCCESS` | `#60685234` | [`0x4eff5709...0e21b3ff`](https://testnet.snowtrace.io/tx/0x4eff5709f5e90beea93646484c6f3befe9805787619a2d3efc9e885b0e21b3ff) | *Ghi rõ: Chuyển 0.5 USDC tới ví Agent EOA (0x374b...), không phải ví phiên* |
| **A4** | Owner setMissionPayeeRoot | Gọi trực tiếp contract | `SUCCESS` | `#60685237` | [`0x842632c7...e0a8f186`](https://testnet.snowtrace.io/tx/0x842632c7bbb83e994f6616752fc558a55c115738625f1ce0a58b33b3e0a8f186) | Thiết lập Merkle root 0xc6ce8ae3... cho contractor 0x11111111... |
| **A7** | **Attack Sim: PayeeNotInMissionSet** | Gọi trực tiếp contract | `REVERTED` | `#60685364` | [`0xc5f13e5d...fea4f1ff`](https://testnet.snowtrace.io/tx/0xc5f13e5d2986633182ba8d69d5560429b063c5bf5f871c6908962933fea4f1ff) | **Giả lập server bị chiếm:** gọi trực tiếp proposeWithProof tới người nhận ngoài Merkle set → **REVERT thật trên contract** |
| **A8** | Owner anchorMissionProof (cũ) | Gọi trực tiếp contract | `SUCCESS` | `#60686583` | [`0x6b3f0b59...41e1da6f`](https://testnet.snowtrace.io/tx/0x6b3f0b59cc3b47b4b8f25f44a845aef07f187d4a2f2b32cb9847b51541e1da6f) | *Ghi rõ: Neo head có chứa entry sai về địa chỉ ví phiên bước A3b; không dùng làm bằng chứng nghiệm thu audit head* |
| **A9** | Owner ERC-8004 giveFeedback | Gọi trực tiếp contract | `SUCCESS` | `#60685371` | [`0xeddde3d3...b0bc9105`](https://testnet.snowtrace.io/tx/0xeddde3d3cbc654996ad00c4945dc5790ae9c073b2e13181f92b477f9b0bc9105) | Ghi nhận danh tiếng on-chain (điểm 87, tag 'starred') trên ReputationRegistry Fuji |

---

## PHẦN B: LUỒNG ĐẦY ĐỦ QUA APP API & VÍ PHIÊN (MISSION `fuji-live-mission-s1b`)

Toàn bộ lifecycle được điều phối qua App API, ký challenge EIP-191 bởi Owner CLI, nạp đúng ví phiên thật, và kiểm chứng receipt on-chain:

| Bước | Hành động | Kênh thực thi | Trạng thái | Block | Transaction Hash | Chi tiết kiểm chứng |
|---|---|---|---|---|---|---|
| **B1** | Owner tạo Mission qua App Challenge | Qua App API | `SUCCESS` | — | `POST /api/missions` | Ký challenge EIP-191 bằng Owner CLI, tạo mission `fuji-live-mission-s1b` trong DB |
| **B2** | Owner fundMissionWallet tới Session Wallet | Gọi trực tiếp contract | `SUCCESS` | `#60687230` | [`0xd1eb4765...2bf91557`](https://testnet.snowtrace.io/tx/0xd1eb476548bbca809a415f2e867d546998377e3e61a58afb3db83d2f2bf91557) | Chuyển 0.5 USDC từ Treasury vào ĐÚNG ví phiên `0x46a84a9f...` |
| **B3** | Owner setMissionPayeeRoot | Gọi trực tiếp contract | `SUCCESS` | `#60687235` | [`0x2a4c8f4a...b63f90a4`](https://testnet.snowtrace.io/tx/0x2a4c8f4a9461a8253eb52bbc35a28e59db6d90f75741ebeef3a17818b63f90a4) | Đặt Merkle root trên GuardedTreasury cho tập người nhận đã ký |
| **B4** | Owner kích hoạt Mission & Xác thực Fuji | Qua App API | `SUCCESS` | — | `POST /api/missions/[slug]/activate` | Ký challenge EIP-191; App gọi verifyFundingReceiptOnFuji và verifyPayeeRootReceiptOnFuji; ghi nhận audit entry hợp lệ |
| **B5** | Agent x402 Tool Settlement (EIP-3009) | Qua App API | `SUCCESS` | `#60689764` | [`0x8c898c90...20dc8208`](https://testnet.snowtrace.io/tx/0x8c898c904fef42c9a2e5d45b18549bd48dce285ef81d497f588ae41320dc8208) | Ví phiên `0x46a84a9f...` ký EIP-3009; Facilitator PayAI settle gasless tới seller |
| **B6** | Agent proposeWithProof Payout | Qua App Validator & Contract | `SUCCESS` | `#60689765` | [`0x769484bb...46cd6c9a`](https://testnet.snowtrace.io/tx/0x769484bb45b13a42917972dabb206697ec4f21acd117394017a62e0046cd6c9a) | Validator phê duyệt provenance OWNER_MISSION; agent gọi proposeWithProof với Merkle proof; chuyển 0.2 USDC cho contractor |
| **B7** | Owner anchorMissionProof (REAL HEAD) | Gọi trực tiếp contract | `SUCCESS` | `#60689767` | [`0x43bd21b8...6ceb0547`](https://testnet.snowtrace.io/tx/0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547) | Neo đỉnh chuỗi kiểm toán THẬT (0x7d46d875...) từ DB lên GuardedTreasury |
| **B8** | Đối chiếu /verify trên Trình duyệt | Trình duyệt Client | `SUCCESS` | — | Ảnh: `fuji-verify-anchor.png` | Tính lại hash chain phía client, xác nhận khớp 100% với giá trị neo trên contract |

---

## 3. BẤT BIẾN AN TOÀN ĐÃ CHỨNG MINH THỰC TẾ

1. **Thanh toán x402 gasless thực tế qua Facilitator (Bước B5):**
   - Ví phiên ký ủy quyền `TransferWithAuthorization` (EIP-3009) qua App API.
   - Facilitator PayAI phát sóng giao dịch thanh toán lên Fuji (`from: 0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63`).
   - Agent và ví phiên trả **0 AVAX tiền gas**; thanh toán được chuyển đến `0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB`.
   - Trạng thái giao dịch được lưu vết trong cơ sở dữ liệu ở trạng thái `SETTLED`.

2. **Ngân sách khóa on-chain vào ví phiên thật (Bước B2):**
   - Owner gọi `fundMissionWallet` cấp 0.5 USDC từ GuardedTreasury vào đúng ví phiên `0x46a84a9f6b9be739c9aa02319497abe7b9f23843`.
   - Ví phiên không thể chi tiêu vượt quá số dư được cấp trên smart contract.

3. **Nguồn gốc người nhận (Provenance Merkle Set - Bước B3 & B6):**
   - Khoản thanh toán 0.2 USDC chỉ được thực hiện khi có Merkle proof hợp lệ khớp với `missionPayeeRoot` do Owner ký.

4. **Chặn tấn công on-chain (Bước A7 - REVERTED):**
   - Khi Agent bị chiếm quyền và gửi giao dịch chuyển tiền tới ví kẻ tấn công, smart contract `GuardedTreasury` **revert ngay lập tức với lỗi `PayeeNotInMissionSet`**, không một xu nào bị rút.

5. **Neo đỉnh chuỗi kiểm toán thật (Bước B7 & B8):**
   - Đỉnh băm chuỗi kiểm toán `0x7d46d87541ed812ada52afe7f1d3144d6a2b90b359a66162e54c8e41d675be2f` được đọc trực tiếp từ DB (`mission.auditHeadHash`) và neo bất biến lên smart contract `GuardedTreasury`.
   - Trang `/verify/fuji-live-mission-s1b` kiểm tra tính lại hash chain hoàn toàn khớp với on-chain.
