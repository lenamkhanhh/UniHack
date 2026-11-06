# UniHack — review hiện tại và nhiệm vụ tiếp theo

Cập nhật: 2026-11-07 03:10, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack — nhánh `feat/s1-app`, HEAD `ddd6d16`.
Báo cáo đã đọc: REPORT_REVIEW_AND_FIX_COMPLETION.md (bản commit `ddd6d16`).
Kế hoạch: STRATEGY_MAX_SCORE.md.

## 1. Hai file trao đổi cố định

- REVIEW_PROMPT_GPT.md: reviewer cập nhật verdict và yêu cầu hiện hành.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: Gemini cập nhật kết quả/evidence (ngắn, theo bảng acceptance).

## 2. Verdict

### 2.1 Chấp nhận (reviewer đã kiểm lại)

| ID | Kết quả |
|---|---|
| UI-02b | Đạt. Reg 17: pause thật qua route có chữ ký → agent + orchestrate trả 403 → unpause chạy lại. |
| VER-02 | Đạt. `scripts/verify-proof.ts` dùng chung `lib/proof-verifier.ts`; thiếu inner `prev_hash` → FAIL. |
| INJ-01b | Đạt. Không còn kích hoạt theo từ khóa. |
| HYG-01 | Đạt. `tsconfig.tsbuildinfo` không còn tracked. |
| P1-B (contract) | Đạt phần contract: `anchorMissionProof` + event + test. |
| Test | Reviewer chạy lại: **forge 30/30**, **vitest 96/96 (8 files)**, `tsc` exit 0. |

### 2.2 Chưa đạt

| ID | Mức | Vị trí | Vấn đề | Yêu cầu |
|---|---|---|---|---|
| **SW-01** | **Critical** | `apps/web/lib/session-wallets.ts:24-28` | Private key ví phiên = `keccak256("${MISSION_TOKEN_SECRET}:session-wallet:${missionSlug}")`. Có 3 vấn đề. (1) Fallback **viết cứng trong code** `'unihack-session-wallet-secret-dev-fallback-key-32chars'`. (2) README công bố sẵn giá trị `MISSION_TOKEN_SECRET` mẫu. (3) Slug mission là công khai (URL proof). Ai biết secret, kể cả secret mẫu hoặc fallback, sẽ **tính được key của mọi ví phiên** và rút sạch. Ngoài ra, dùng chung secret JWT để sinh key nghĩa là lộ một secret thì mất cả auth lẫn tiền. Đây chính là loại lỗi giống khóa Anvil (KEY-01/02). | Bỏ fallback. Ưu tiên: sinh key **ngẫu nhiên** (`generatePrivateKey`) mỗi mission, lưu **mã hóa** (AES-GCM với `SESSION_WALLET_ENCRYPTION_KEY` riêng) trong DB, không log. Nếu vẫn derive thì phải dùng `SESSION_WALLET_SEED` riêng ≥32 byte ngẫu nhiên, khác `MISSION_TOKEN_SECRET`, và chạy HKDF. `validateLiveFujiConfig()` từ chối khi thiếu biến, trùng secret JWT, hoặc trùng giá trị mẫu trong README/.env.example. Có test cho từng trường hợp. |
| **ERC-01** | **High** | `apps/web/lib/erc8004.ts:19-66` | **ABI tự bịa, không khớp contract đã deploy**: `giveFeedback(address agent, int128, uint8, string tag)`, `getAgent(address)`, `getReputation(address, string)` không tồn tại. Trên Fuji mọi lệnh gọi sẽ revert. Reviewer đã đọc ABI verified trên Routescan (proxy ERC1967): |  Dùng đúng ABI dưới đây (pin vào file JSON trong repo kèm địa chỉ implementation + nguồn). `agentId` là **uint256** (ERC-721 tokenId), không phải address. Feedback do **mission owner** (client) gửi, không phải agent tự gửi. Test encode bằng ABI thật (vd. `encodeFunctionData`) và so selector. |
| ERC-02 | Medium | `erc8004.ts` (MOCK branch) | MOCK trả `txHash = keccak256(...)`, trông như một tx hash thật. Nếu hiển thị lên UI hoặc deck sẽ thành giao dịch giả. | MOCK trả `txHash: null` + `mode: 'MOCK'`; UI không render link Snowtrace khi không có tx thật. |
| **SW-02** | High | `GuardedTreasury.sol` `sweepMissionWallet` | Sweep dùng `safeTransferFrom(wallet → treasury)`, cần ví phiên đã `approve` cho treasury. Không có code nào tạo approve, và ví phiên không có AVAX để trả gas cho approve. Test chỉ pass nhờ `vm.prank(sessionWallet); usdc.approve(...)`. Trên Fuji sweep **không bao giờ chạy được**. | Sweep bằng EIP-3009: ví phiên ký `transferWithAuthorization(to=treasury)` (hoặc `receiveWithAuthorization`) off-chain, backend/owner submit (gasless cho ví phiên). Hoặc thêm hàm contract nhận authorization đã ký. Test không dùng `approve` giả. |
| SW-03 | Medium | `fundMissionWallet(bytes32,address)` | Nếu chưa set `missionToolCap`, số tiền fund mặc định = `perTxCap`, một giá trị không liên quan tới budget. | Bắt buộc đã set tool cap (hoặc truyền amount rõ ràng); amount ≤ cap đã set. |
| P1-WIRE | Medium | backend | Không có code backend nào gọi `fundMissionWallet`, `anchorMissionProof` hay `submitErc8004Feedback` (grep chỉ thấy định nghĩa). Ở S2, payer là ví phiên nhưng chưa bao giờ được fund. | Nối vào lifecycle ở S2: activate → fund; complete → anchor; settled + owner xác nhận → feedback. MOCK không gửi tx, ghi rõ mode. Report ghi đúng: contract đã có, wiring đang chưa có/đã có. |

**ABI thật trên Fuji** (đọc từ Routescan, implementation verified):

ReputationRegistry proxy `0x8004B663056A597Dffe9eCcC1965A193B7388713` → impl `0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34`:
```
giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)
getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) -> (uint64, int128, uint8)
readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) -> (int128, uint8, string, string, bool)
readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) -> (...)
getClients(uint256 agentId) -> address[]
revokeFeedback(uint256 agentId, uint64 feedbackIndex)
```
IdentityRegistry proxy `0x8004A818BFB912233c491871b3d84c89A494BD9e` → impl `0x7274e874CA62410a93Bd8bf61c69d8045E399c02`:
```
register() / register(string agentURI) / register(string agentURI, tuple[] metadata) -> uint256
setAgentURI(uint256 agentId, string newURI)
ownerOf(uint256 tokenId) -> address ; tokenURI(uint256 tokenId) -> string
```
Lấy ABI đầy đủ bằng: `https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api?module=contract&action=getabi&address=<impl>`.

## 3. Nhiệm vụ tiếp theo (đúng thứ tự)

1. **SW-01** (critical) → **ERC-01** → **SW-02** → ERC-02, SW-03.
2. **P1-WIRE**: nối fund/anchor/feedback vào lifecycle S2, MOCK không gửi tx.
3. Cập nhật README: bảng tổn thất tối đa sau P1-A; danh sách biến env bắt buộc cho LIVE (không có giá trị mẫu dùng được).
4. Sau đó dừng phát triển tính năng mới. Chuẩn bị Bước 5 phần không cần Fuji: README chính (câu định vị, ảnh, quickstart), outline deck 11 slide theo STRATEGY §7 (sửa DECK-01..06). Ô tx/link để trống có nhãn `PENDING_FUJI`.

## 4. Acceptance lượt tới

| ID | Điều kiện đạt | Bằng chứng |
|---|---|---|
| SW-01 | Không fallback; key ngẫu nhiên mã hóa (hoặc seed riêng + HKDF); LIVE từ chối cấu hình yếu | Test + diff |
| ERC-01 | ABI pin từ contract thật; selector khớp; agentId uint256; client = owner | Test encode |
| SW-02 | Sweep không cần approve/gas của ví phiên; test không prank approve | `forge test` |
| ERC-02 / SW-03 | Như mục 2.2 | Test |
| P1-WIRE | Lifecycle S2 gọi fund/anchor/feedback; MOCK ghi đúng mode | Test handler |
| README/DECK | README mới + outline deck, không có tx giả | Đường dẫn file |

## 5. Giới hạn thực thi

- Không hiển thị kết quả, giao dịch, verdict hay trạng thái mà hệ thống không thực sự tạo ra (kể cả tx hash "simulated").
- Không có secret/key fallback viết cứng trong code cho bất kỳ đường nào giữ tiền.
- Không broadcast lên Fuji khi owner chưa điền ví mới vào `.env` và chưa duyệt.
- Không dùng khóa Anvil/Hardhat trên mạng công khai; không đọc/in/commit key.
- Không push `main`, không deploy public, không nộp bài khi owner chưa duyệt.

## 6. Prompt cho Gemini

~~~text
Đọc REVIEW_PROMPT_GPT.md (bản 03:10). Báo cáo ngắn vào REPORT_REVIEW_AND_FIX_COMPLETION.md.

Chấp nhận: UI-02b, VER-02, INJ-01b, HYG-01, anchorMissionProof. Reviewer chạy lại forge 30/30,
vitest 96/96, tsc ok.

Sửa theo thứ tự:
- SW-01 (critical): key ví phiên đang derive từ MISSION_TOKEN_SECRET + slug công khai, có fallback
  viết cứng → ai biết secret mẫu/fallback rút được mọi ví. Đổi sang key ngẫu nhiên lưu mã hóa
  (hoặc seed riêng + HKDF), bỏ fallback, LIVE từ chối cấu hình yếu.
- ERC-01: ABI ERC-8004 đang tự bịa. Dùng ABI thật ở mục 2.2 (agentId uint256,
  giveFeedback 8 tham số, register(string)); pin JSON + test selector.
- SW-02: sweep không được dựa vào approve của ví phiên; dùng EIP-3009 authorization.
- ERC-02 (MOCK không trả tx hash giả), SW-03 (fund phải có tool cap rõ).
Sau đó P1-WIRE (nối fund/anchor/feedback vào lifecycle S2), README env/tổn thất,
rồi README chính + outline deck với ô tx để PENDING_FUJI.

Commit trên feat/s1-app, không push main, không deploy public, không broadcast.
~~~

## 7. Nhật ký reviewer

Chỉ sửa REVIEW_PROMPT_GPT.md.
Lệnh đã chạy: đọc output watcher; `git log`, `git diff --stat 95cb2c3 HEAD`; đọc `session-wallets.ts`, diff `GuardedTreasury.sol` và `payments.ts`, ABI trong `erc8004.ts`, test sweep; grep nơi gọi fund/anchor/feedback; `curl` Routescan `getsourcecode` + `getabi` cho 2 proxy/implementation ERC-8004 trên Fuji (chỉ đọc); `forge test` (30/30); `vitest run` (96/96); `tsc` (exit 0); grep `MISSION_TOKEN_SECRET` trong config/README.
