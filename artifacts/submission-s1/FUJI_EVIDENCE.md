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

---

## PHẦN C: BẰNG CHỨNG WOW (W2: ERC-8004 VALIDATION REGISTRY TRÊN FUJI)

| Bước | Hành động | Trạng thái | Block | Transaction Hash | Chi tiết kiểm chứng |
|---|---|---|---|---|---|
| **C1** | Deploy ValidationRegistry | `SUCCESS` | `#60710685` | [`0x08ff8ae8...4ff26`](https://testnet.snowtrace.io/tx/0x08ff8ae876a23c2f7cf35ef2a326822a16fe83a394c4526ae1a52d714bd4ff26) | Deploy `ValidationRegistry.sol` tại [`0x4c5ccda2a630cd1cb706799deadcc8483d06697e`](https://testnet.snowtrace.io/address/0x4c5ccda2a630cd1cb706799deadcc8483d06697e), verified trên Snowtrace/Routescan & Sourcify |
| **C2** | Owner Funds Validator Gas | `SUCCESS` | `#60710618` | [`0xc7301ee0...83202`](https://testnet.snowtrace.io/tx/0xc7301ee0cd4d0ba6d9d9ea58a6acf8a7a75cc31ccea68a292538fc2e9d283202) | Nạp 0.03 AVAX từ Owner sang ví Validator EOA `0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5` |
| **C3** | Register Agent on IdentityRegistry | `SUCCESS` | `#60710648` | [`0xb5646950...507c8`](https://testnet.snowtrace.io/tx/0xb5646950b8a1541b5b18a3812b8c17b7c3abc88fb91b0857bd142dd9991507c8) | Đăng ký Agent MissionPay trên IdentityRegistry chính thức Fuji (`0x8004A818BFB912233c491871b3d84c89A494BD9e`), cấp Agent ID **#294** |
| **C4** | Broadcast validationRequest | `SUCCESS` | `#60710837` | [`0x0374b23d...ca48e`](https://testnet.snowtrace.io/tx/0x0374b23d87c4b46e8121a776d0c6419aea2de2808651614403a79ca02b0ca48e) | Owner gửi yêu cầu xác thực độc lập cho mission s1b với `requestHash = 0x20f83cc1...d6110` |
| **C5** | Broadcast validationResponse | `SUCCESS` | `#60710854` | [`0x62451c36...fe1564`](https://testnet.snowtrace.io/tx/0x62451c36b6488cf4423bd7427e560ac2e3de46144d7ba5c30d81c55df7fe1564) | Validator EOA độc lập đọc chain và gửi phản hồi: `score = 100`, tag = `"verified-full"`, `isComplete = true` |
| **C6** | Verify UI Display & E2E | `SUCCESS` | — | Ảnh: `deck-shots/wow-w2-erc8004.png` | Playwright test `erc8004-validation.spec.ts` xác thực hiển thị trực tiếp điểm 100/100, tag verified-full, địa chỉ validator và link Snowtrace |

### Lệnh kiểm chứng độc lập bằng `cast call`:
```bash
cast call --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  0x4c5ccda2a630cd1cb706799deadcc8483d06697e \
  "getValidationStatus(bytes32)(address,uint256,uint8,bytes32,string,uint256)" \
  0x20f83cc1c500af5ad3bf7b8fc2d1c5827cf2acf10454c72391e4f3f5765d6110
```
Kết quả trả về:
- `validatorAddress`: `0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5`
- `agentId`: `294`
- `response` (score): `100`
- `tag`: `"verified-full"`
- `lastUpdate`: `1794105823`

---

## Phần D — Bằng chứng WOW-W4 & PK-F1: Passkey Mission Authority (RIP-7212 Precompile 0x100)

Hệ thống xác thực WebAuthn P-256 sinh trắc học (Passkey) trực tiếp trên Avalanche Fuji thông qua native precompile RIP-7212 tại địa chỉ `0x0000000000000000000000000000000000000100`.

### 1. Smart Contracts Triển khai trên Avalanche Fuji

| Hợp đồng | Địa chỉ Fuji | Giao dịch Triển khai | Block | Ghi chú |
|---|---|---|---|---|
| **PasskeyMissionAuthority (PK-F1 Hardened)** | [`0x46f48bece672266541d73d752684859a8f3c8aef`](https://testnet.snowtrace.io/address/0x46f48bece672266541d73d752684859a8f3c8aef) | [`0x3633e6c6...46f4`](https://testnet.snowtrace.io/tx/0x3633e6c64e3428882e5c1e07df1d58e2b89bf457373d827b4b63c8e0c32946f4) | #60724326 | Bản nâng cấp PK-F1: kiểm RP ID hash, strict origin, UV flag, reject crossOrigin, low-S |
| **GuardedTreasury (Passkey Demo v2)** | [`0x58d5bcd57c3cf089dc93b0e3f5f6def3a69a81af`](https://testnet.snowtrace.io/address/0x58d5bcd57c3cf089dc93b0e3f5f6def3a69a81af) | [`0xc533510d...266d`](https://testnet.snowtrace.io/tx/0xc533510d3d1d5087ea4dcfccb2cdda768abb00822f279fe73e8420b76f4e266d) | #60724322 | Treasury do PasskeyAuthority hardened sở hữu |
| **PasskeyMissionAuthority (Pre-Hardening)** | [`0x77235386fe59A934645C5F273e411b0Bea8cCc9C`](https://testnet.snowtrace.io/address/0x77235386fe59A934645C5F273e411b0Bea8cCc9C) | [`0x5a632049...1c97e`](https://testnet.snowtrace.io/tx/0x5a63204914dcd34568790681bae0c608d012cc64c5328903d9dcb6db9d71c97e) | #60712049 | Bản triển khai ban đầu (Verified trên Snowtrace/Routescan, GUID: `00ec6faf...`) |
| **GuardedTreasury (Passkey Demo v1)** | [`0x33a6bcf988a9056a3fc78b62560ec40b3c8c4bb3`](https://testnet.snowtrace.io/address/0x33a6bcf988a9056a3fc78b62560ec40b3c8c4bb3) | [`0x2e68262b...cc2b`](https://testnet.snowtrace.io/tx/0x2e68262b7e102803ec8eebbbc4ae1398dfc2c05359155fb84667482280cfcc2b) | #60712046 | Treasury demo instance ban đầu |

### 2. Giao dịch Duyệt Mission qua WebAuthn Assertion

#### A. PK-F1 Hardened Instance (Bản Nâng Cấp Hoàn Toàn):
- **Tx Hash:** [`0x494b664be33d2c2d08575884f3ceb546779e8c7eb8eaec0bed171a11f0d7a929`](https://testnet.snowtrace.io/tx/0x494b664be33d2c2d08575884f3ceb546779e8c7eb8eaec0bed171a11f0d7a929)
- **Block Number:** #60724328
- **Gas Used:** **400,354 gas** (Bao gồm kiểm tra đầy đủ RP ID hash, origin match `"origin":"http://localhost:3100"`, User Presence & User Verification flags `0x05`, RIP-7212 precompile `0x100`)
- **Status:** `SUCCESS` (100% on-chain verification)
- **Thông số nhiệm vụ on-chain:**
  - `agent`: `0x374b8A126FDb9e5deEc8307da385076155Af3D72`
  - `cap`: 2,000,000 ($2.00 USDC)
  - `toolCap`: 500,000 ($0.50 USDC)
  - `payeeRoot`: `0xa7409058568815d08a7ad3c7d4fd44cf1dec90c620cb31e55ad24c654f7ba34f`
  - `exists`: `true`

#### B. Pre-Hardening Instance (Giao Dịch Ban Đầu):
- **Tx Hash:** [`0x9885664fcfc45539af1183fa3768f6e2dbfb52c76544b7b6f1ee14833790cf45`](https://testnet.snowtrace.io/tx/0x9885664fcfc45539af1183fa3768f6e2dbfb52c76544b7b6f1ee14833790cf45)
- **Block Number:** #60712056
- **Gas Used:** **281,498 gas**




### W3 Bounty Setup: "Hack the Treasury" (Mission `missionpay-bounty-v1`)
- **Mission ID:** `0x609d0c2a96678100e4419faa96fccaaf6b809c245d75b02afa0d18e9c93a560f`
- **Guarded Treasury:** `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`
- **Target Cap:** 5.00 USDC (`5000000` atomic)
- **Authorized Payee Set:** `0x1111...1111`, `0x2222...2222` (Root: `0xc6ce8ae383124b268df66d71f0af2206e6dafb13eba0b03806eed8a4e7991329`)
- **Expiry:** 2026-12-20 UTC
- **Transactions:**
  - `createMission`: [`0x16a4a45ca84dc3a157dccf80a25f989cac24b5d5a004e5b9322124df7c4e7afd`](https://testnet.snowtrace.io/tx/0x16a4a45ca84dc3a157dccf80a25f989cac24b5d5a004e5b9322124df7c4e7afd)
  - `setMissionPayeeRoot`: [`0x12062261f369384bf06b9f4747f8e335a7a57951ec6509e6791ab1ba879f5dc3`](https://testnet.snowtrace.io/tx/0x12062261f369384bf06b9f4747f8e335a7a57951ec6509e6791ab1ba879f5dc3)
  - `fundTreasury` (5 USDC): [`0xd0654d4d695ff1b3a81dbc3785c39123859c1907a9b165782a1ea87e6c599934`](https://testnet.snowtrace.io/tx/0xd0654d4d695ff1b3a81dbc3785c39123859c1907a9b165782a1ea87e6c599934)

## PHẦN E: BẰNG CHỨNG x402 v2 TRÊN AVALANCHE FUJI (CAIP-2 eip155:43113)

Bằng chứng thực thi giao dịch thanh toán tài nguyên AI theo chuẩn giao thức **x402 v2** (định dạng định danh mạng CAIP-2 `eip155:43113`, tiêu đề `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, trường giá `amount`, và ràng buộc mật mã nonce `computeBoundNonce` theo ATC'26 F1):

| Thông số | Giá trị kiểm chứng thực tế |
|---|---|
| **Giao thức** | **x402 v2** (`x402Version: 2`, Scheme: `exact`, CAIP-2: `eip155:43113`) |
| **Hành động** | Mua công cụ tìm kiếm `tool:search` qua cơ chế thanh toán vi mô khí gas bằng 0 cho Agent |
| **Giao dịch Settle Hash** | [`0x7e3b18eea005f6b1cfa6b9ec4008998629be595f0e1046988d81f55d95fbbe19`](https://testnet.snowtrace.io/tx/0x7e3b18eea005f6b1cfa6b9ec4008998629be595f0e1046988d81f55d95fbbe19) |
| **Block Number** | `#60751475` |
| **Người gửi Giao dịch (Relayer)** | `0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63` (Facilitator chuyên dụng, độc lập với ví Owner và Treasury) |
| **Người trả tiền (Payer)** | Ví phiên an toàn `0x46a84a9f6b9be739c9aa02319497abe7b9f23843` |
| **Người nhận tiền (Seller)** | Nhà cung cấp công cụ `0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB` |
| **Số tiền thanh toán** | **0.10 USDC** (`100000` atomic units) |
| **Trạng thái on-chain** | **`SUCCESS`** (Log `Transfer` và `AuthorizationUsed` xác nhận trên Avalanche Fuji) |
| **Trạng thái DB & Header** | Trạng thái `SETTLED`, trả về tiêu đề chuẩn `PAYMENT-RESPONSE` |
