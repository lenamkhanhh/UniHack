# 02 — x402 tool marketplace + TalkMeter (Fuji)

**Mục tiêu:** agent mua tool bằng USDC qua HTTP 402, trả đúng tiền,
đúng người, đúng lần, không approve vô hạn, và mọi lần mua đều có
tx hash để khoe.

## 1. Chọn phiên bản x402 — quyết định này phải chốt ở spike, không đổi giữa chừng

- **MVP dùng x402 v1, scheme `exact`, EVM, EIP-3009.** Lý do: GateKeep
  và các ví dụ Avalanche hiện có dùng v1 (`X-PAYMENT` /
  `X-PAYMENT-RESPONSE`); v2 đổi header và thêm adapter, trộn hai
  phiên bản là lỗi tương thích khó debug nhất.
- Nếu facilitator chọn chỉ hỗ trợ v2, thì **đổi cả client lẫn server
  sang v2 cùng lúc**, ghi rõ version vào README, và test lại toàn bộ
  flow 402 → pay → 200. Không vá nửa v1 nửa v2.
- Network string trong code facilitator: `"avalanche-fuji"` cho Fuji
  (Thirdweb) hoặc CAIP-2 `eip155:43113` tùy middleware — lấy đúng
  string của middleware đang dùng, đừng đoán.

## 2. Facilitator — thứ tự thử, và fallback phải có sẵn

| Ưu tiên | Facilitator | Khi nào dùng / bỏ |
|---|---|---|
| 1 (thử trước) | Ultravioleta hosted: `https://facilitator.ultravioletadao.xyz` | Nhanh nhất. Client chỉ cần USDC, facilitator trả gas AVAX. Bỏ nếu spike ngày 1 không ra tx hash. |
| 2 | Thirdweb hosted (tạo từ client + server wallet) | Dùng nếu Ultravioleta không ổn. Settlement wait = `confirmed` cho demo. Kiểm tra `supported()` trước. |
| 3 (fallback tự host) | x402-rs: `docker run --env-file .env -p 8080:8080 ukstv/x402-facilitator`, env `RPC_URL_AVALANCHE_FUJI`, `SIGNER_TYPE=private-key` | Chỉ build nếu cả 2 hosted đều fail. Chạy bằng key testnet, không bao giờ dùng key mainnet. |

**Quy tắc sống còn:** facilitator không giữ tiền user, không sửa được
amount/destination trong authorization đã ký — nhưng nó có thể down.
Vì vậy: (a) ghi tx hash thành công sớm, (b) demo video quay từ tx
hash thật đã có, không phụ thuộc 100% vào live lúc chấm, (c) nếu
facilitator down lúc chấm, fallback là chiếu tx hash + audit ledger,
không phải bịa flow.

## 3. Wire protocol — copy đúng format này, đừng tự chế header

### 3.1. Unpaid request → 402

Client gọi tool mà không có `X-PAYMENT`. Server trả `402` với body
`accepts[]` (v1), mỗi phần tử gồm:

```json
{
  "scheme": "exact",
  "network": "avalanche-fuji",
  "maxAmountRequired": "500000",
  "asset": "0x5425890298aed601595a70AB815c96711a31Bc65",
  "payTo": "<seller-wallet>",
  "resource": "https://<app>/api/tools/summary",
  "maxTimeoutSeconds": 60,
  "extra": { "name": "USD Coin", "version": "2" }
}
```

- `maxAmountRequired` là atomic units (6 decimals): $0.50 = `500000`.
- `maxTimeoutSeconds` = 60 cho MVP: authorization hết hạn sau 60s,
  không để authorization sống lâu.

### 3.2. Sign — agent ký, không gửi transaction

Agent ký EIP-712 / EIP-3009 `TransferWithAuthorization`:

```solidity
// struct đã ký — facilitator không sửa được field nào trong này
struct TransferWithAuthorization {
    address from;        // ví agent
    address to;          // payTo từ 402
    uint256 value;       // đúng maxAmountRequired, không hơn
    uint256 validAfter;  // now
    uint256 validBefore; // now + 60s
    bytes32 nonce;       // random 32 bytes, dùng 1 lần, USDC tự track
    // + v, r, s (EIP-712 signature, domain = USDC token)
}
```

**Không bao giờ:** dùng `approve(type(uint256).max)` cho tool payment.
Approve vô hạn là đúng cái mà sản phẩm này chống lại — demo mà dùng
nó thì pitch tự phủ định.

### 3.3. Paid retry → 200 + receipt

Client retry với header `X-PAYMENT` (base64 JSON chứa authorization
đã ký). Server qua facilitator:

1. **Verify trước, serve sau.** Facilitator verify signature, balance,
   nonce. Fail → trả 402 mới, không serve resource.
2. **Settle, rồi mới serve (hoặc serve kèm receipt).** Settlement fail
   → resource không trả, client nhận 402 mới.
3. **No money for nothing:** nếu upstream tool lỗi (non-2xx) thì agent
   không bị charge — server phải check upstream trước khi settle, hoặc
   hoàn logic theo GateKeep: upstream fail → không settle.
4. Trả `200` + header `X-PAYMENT-RESPONSE` chứa tx hash settlement.
   Frontend hiển thị link Snowtrace từ tx hash này, không chụp màn
   hình thay bằng chứng.

### 3.4. Mock vs live — ghi rõ, không lẫn

| Chế độ | Verify signature | Settle on-chain | Dùng khi |
|---|---|---|---|
| Live Fuji | Thật (EIP-712/EIP-3009) | Thật, có Snowtrace tx | Demo, video, nộp bài |
| Mock (rehearsal) | Thật (ký thật) | Giả lập, không có tx thật | Tập demo offline, test UI khi facilitator down |

Mock mà trình bày như live là mất uy tín nhanh nhất. Mọi nơi dùng
mock phải có chữ `MOCK` trong UI và video.

## 4. Tool catalog — chỉ 3 tool trong MVP, không thêm tool cho vui

| Tool ID | Làm gì | Giá | Cap | Ghi chú |
|---|---|---|---|---|
| `tool:search` | Tìm + tóm tắt ngắn 1 nguồn (input: query, output: 3 bullet + nguồn) | $0.10 / call = `100000` | Per-call $0.10, không session cap riêng | Dùng cho scene demo 2 |
| `tool:summary` | Tóm tắt tài liệu ngắn (input: text ≤ 2000 chars, output: summary ≤ 500 chars) | $0.50 / call = `500000` | Per-call $0.50 | Tool chính của scene 2 |
| `tool:talkmeter` | Meeting timer + tóm tắt theo phút (xem §5) | $0.05 / phút = `50000` / phút | Session cap $2.00 = `2000000`, tự dừng khi chạm cap | Tool TalkMeter, không phải app meeting |

**Tool allowlist:** chỉ 3 tool trên được pre-flight cho qua. Tool lạ,
giá lạ, seller lạ → BLOCK, không tự thêm tool từ output LLM.

**Seller wallet:** mỗi tool có 1 `payTo` cố định, ghi trong config
server, không lấy `payTo` từ request của client hay từ LLM output.
LLM mà đổi được `payTo` thì toàn bộ guard vô nghĩa.

## 5. TalkMeter — metered billing, làm đúng kiểu này

TalkMeter trong hybrid **không** phải app họp đầy đủ. Nó là:

1. User bấm Start → tạo session, ghi `sessionId`, `startedAt`,
   `cap = $2.00`, `rate = $0.05/phút`.
2. Mỗi phút hoàn thành → 1 lần x402 payment $0.05 cho seller, hoặc
   gộp: tick mỗi phút, settle mỗi phút (đơn giản, dễ demo, dễ kiểm
   tra tx hash từng phút). Không dùng channel/`upto` trong MVP —
   channel cần thêm logic deposit và dispute, ngoài scope.
3. Hết session (user bấm Stop, hoặc chạm cap $2.00) → trả summary:
   số phút, tổng tiền, danh sách tx hash từng phút.
4. Session mô phỏng (không có mic thật, không có audio thật) phải ghi
   `SIMULATED SESSION` trong UI. Timer thật + summary từ text user
   nhập là đủ cho demo; đừng giả vờ có transcription từ mic nếu
   không có mic.

**Luật dừng (velocity/circuit breaker, lấy từ Wallie):**

- Quá session cap → dừng, không ký thêm phút nào.
- Quá 10 tick/phút bất thường (tick dồn, clock sai) → dừng session,
  ghi audit `velocity_circuit_breaker`.
- Guard paused → TalkMeter tick cũng dừng (pre-flight check paused).

## 6. Pre-flight cho tool payment — 6 luật, chạy trước mọi lần ký

Chạy ở server, bằng code, không bằng prompt (chi tiết full ở 04 §3):

1. `kill_switch`: guard paused → không ký.
2. `host_not_allowlisted`: tool ID + seller không nằm trong allowlist → không ký.
3. `per_call_cap`: giá > per-call cap của tool → không ký.
4. `velocity_circuit_breaker`: quá số call/phút cho phép → không ký.
5. `budget_exhausted`: tổng chi mission/session đã chạm cap → không ký.
6. `human_approval_required`: tool/payment vượt tier auto → chuyển sang
   queue chờ người duyệt, không tự ký.

Mọi lần BLOCK đều ghi audit: tool, giá, rule, reason, thời gian —
không cần tx hash vì chưa có transaction nào xảy ra (đó chính là
điểm tốt: chặn trước khi tiền đi).

## 7. API tool server — endpoint tối thiểu

```
POST /api/tools/search    { query }              -> 402 hoặc 200 + receipt
POST /api/tools/summary   { text }               -> 402 hoặc 200 + receipt
POST /api/tools/talkmeter/start  { title }       -> { sessionId, cap, rate }
POST /api/tools/talkmeter/tick   { sessionId }   -> 402 hoặc 200 + receipt (mỗi phút)
POST /api/tools/talkmeter/stop   { sessionId }   -> { minutes, total, txHashes[] }
GET  /api/tools              -> catalog 3 tool + giá + payTo (không lộ key)
```

**Lỗi trả về phải rõ:** `402` = chưa trả tiền, `402` lại sau khi
settle fail = trả lại, `403` = tool không allowlisted, `503` =
paused hoặc facilitator down. Đừng trả `500` chung cho mọi thứ rồi
để giám khảo đoán.

## 8. Test bắt buộc cho x402 (chi tiết ở 06)

- Unpaid → 402 đúng `accepts[]`, đúng amount, đúng asset, đúng payTo.
- Paid đúng → 200 + tx hash thật trên Snowtrace, balance seller tăng đúng.
- Paid sai amount / sai payTo / nonce đã dùng / hết hạn 60s → fail,
  không serve resource.
- Upstream fail → không charge.
- Over per-call cap / tool lạ → không ký, audit ghi BLOCK.
- Mock mode ghi MOCK, live mode có tx hash — không lẫn hai mode.
