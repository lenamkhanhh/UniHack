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

### 3.3. Paid retry → 200 + receipt (luồng đầy đủ ở §9, đây là tóm tắt)

Client retry với header `X-PAYMENT` (base64 JSON chứa authorization
đã ký) và cùng `X-Operation-Id`. Server qua facilitator:

1. **Upstream chạy nội bộ trước, kết quả được giữ (held), chưa trả.**
   Upstream lỗi → operation FAILED, không charge, không trả 402
   để "thử lại rồi tính tiền" — lỗi upstream trả về lỗi upstream.
2. **Verify trước, settle sau, trả kết quả đã giữ sau cùng.**
   Facilitator verify signature, balance, nonce. Fail → trả 402 mới,
   không trả kết quả đã giữ.
3. Settlement fail → kết quả đã giữ không trả, client nhận 402 mới.
4. Settlement confirmed → trả kết quả đã giữ + `200` + header
   `X-PAYMENT-RESPONSE` chứa tx hash settlement. Frontend hiển thị
   link Snowtrace từ tx hash này, không chụp màn hình thay bằng chứng.
5. **No money for nothing** theo đúng nghĩa trên: upstream lỗi
   trước settlement thì không charge; settlement thành công thì
   kết quả đã giữ được trả, không phải chạy lại upstream.

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

## 6. Pre-flight cho tool payment — 5 luật, chạy trước mọi lần ký

Chạy ở server, bằng code, không bằng prompt (chi tiết full ở 04 §3).
**Tool payment không có human queue trong MVP** — đây là hành vi
duy nhất, đồng bộ với 04 §3. Nếu một tool purchase cần người duyệt,
cách đúng là duyệt một treasury payout để nạp tiền vào ví tool của
agent trước, rồi tool payment mới chạy; không queue chính tool
payment đó.

1. `kill_switch`: guard paused → không tạo reservation mới, không ký.
2. `host_not_allowlisted`: tool ID + seller không nằm trong allowlist → không ký.
3. `per_call_cap`: giá > per-call cap của tool → không ký.
4. `velocity_circuit_breaker`: quá số call/phút cho phép → không ký.
5. `budget_exhausted`: spent + reserved đã chạm mission tool cap
   hoặc session cap → không ký.

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
GET  /api/tools/operations/:operationId -> trạng thái operation + txHash nếu có (xem §9)
```

**Lỗi trả về phải rõ:** `402` = chưa trả tiền, `402` lại sau khi
settle fail = trả lại, `403` = tool không allowlisted, `409` =
operationId dùng lại với input khác, `503` = paused hoặc facilitator
down. Đừng trả `500` chung cho mọi thứ rồi để giám khảo đoán.

## 9. x402 lifecycle, idempotency và reservation — bắt buộc, không phải nâng cao

### 9.1. Operation và trạng thái

Mỗi lần mua tool là một operation, xác định bởi `operationId`:

- Client tạo UUIDv4, gửi header `X-Operation-Id` ở cả request chưa
  trả tiền và request đã trả tiền. Nếu client không gửi, server tạo
  một ID và trả về trong 402 — nhưng lúc đó retry mà không gửi lại
  ID đó sẽ tạo operation mới, không được idempotency.
- Server lưu operation với: `operationId`, `toolId`, `inputHash`
  (hash của input đã normalize: query/text đã trim, không chứa
  secret), `state`, `reservedAmount`, `txHash`, `sessionId`,
  `minuteIndex` (chỉ TalkMeter), `missionId`, `createdAt`.

Trạng thái, theo đúng thứ tự này:

```
CREATED     — 402 đã phát hành, chưa có reservation, chưa có payment
RESERVED    — upstream đã chạy nội bộ thành công, kết quả đang giữ,
              budget đã trừ vào reserved, chờ client trả tiền
SIGNED      — đã nhận X-PAYMENT, authorization verify pass, chưa settle
SETTLING    — facilitator đã nhận và đang submit settlement
SETTLED     — settlement confirmed, kết quả đã giữ được trả, reserved → spent
FAILED      — upstream lỗi, verify lỗi, settle lỗi, hoặc hết hạn 60s
UNKNOWN     — facilitator timeout / response mất sau khi đã submit
```

### 9.2. Budget: spent + reserved

Budget khả dụng cho mission tool cap và cho session cap tính như sau:

```
available = cap − spent − reserved
```

- Reservation tạo khi chuyển sang RESERVED, với amount = giá tool.
- Reservation hết hạn khi authorization hết hạn (60s) hoặc khi
  operation chuyển sang FAILED — lúc đó reserved được trả lại.
- Reservation chuyển thành spent khi SETTLED, không cộng hai lần.

### 9.3. Retry và idempotency — không ký payment mới bừa

- Cùng `operationId` + cùng `inputHash`:
  - Đang RESERVED → trả lại 402 cũ (cùng amount, payTo, asset).
  - Đã SETTLED → trả lại kết quả cũ + tx hash cũ, không ký mới.
  - Đang SETTLING/UNKNOWN → không ký mới, trả trạng thái hiện tại
    và hướng dẫn gọi recovery (xem §9.4).
- Cùng `operationId` + `inputHash` khác → `409`, không chạy.
- Operation khác nhau nhưng cùng input thì là hai lần mua riêng —
  idempotency chỉ theo operationId, không theo input.

### 9.4. Recovery khi settlement UNKNOWN — ngăn charge hai lần

Khi facilitator timeout hoặc response mất sau khi đã submit:

1. Không ký authorization mới, không tạo operation mới cho cùng
   việc đó.
2. Server check `authorizationState(authorizer, nonce)` trên USDC
   Fuji: nonce đã dùng → authorization đã settle, không charge lại.
   Server trả kết quả đã giữ, audit ghi `SETTLED` với ghi chú
   "tx hash đang tra lại từ facilitator" nếu facilitator chưa trả
   tx hash — **không bịa tx hash**.
3. Nonce chưa dùng → operation chuyển sang FAILED, reservation
   được trả lại, client có thể bắt đầu operation mới.
4. Endpoint `GET /api/tools/operations/:operationId` là nơi duy
   nhất client tra trạng thái recovery, không phải đoán từ lỗi.

### 9.5. TalkMeter: unique (sessionId, minuteIndex), phút tính bằng server

- `minuteIndex = floor((serverNow − startedAt) / 60)`, phút 0 là
  phút đầu tiên. Client không được gửi minuteIndex.
- DB unique constraint trên `(sessionId, minuteIndex)`. Tick trùng
  phút đã trả → trả receipt cũ, không ký mới. Tick đồng thời cùng
  phút → một tick thắng unique constraint, tick còn lại nhận
  receipt của tick thắng.
- Tick cho phút tương lai (theo server time) → reject. Tick sau khi
  session đã stop/capped → reject. Tick khi session cap đã chạm →
  session chuyển CAPPED, không ký thêm.
- TalkMeter cũng là operation x402 bình thường: mỗi phút là một
  operation riêng, với `operationId` riêng, để idempotency và
  recovery áp dụng y hệt.

### 9.6. Pause và authorization đã ký — giới hạn phải nói đúng

- Pause chặn: reservation mới, pre-flight mới, ký mới.
- Pause **không** thu hồi authorization đã ký và còn trong 60s TTL.
  Authorization đó vẫn có thể settle trước `validBefore`.
- Rủi ro tồn đọng tối đa: một authorization / tool / phút, TTL 60s,
  per-call cap, và reservation đã trừ vào tool cap — không phải
  rủi ro không giới hạn.
- Settlement nào rơi vào sau thời điểm pause phải ghi audit là
  `SETTLED_AFTER_PAUSE`, kèm thời gian pause và tx hash, không
  được giấu trong audit chung.

## 8. Test bắt buộc cho x402 (chi tiết ở 06)

- Unpaid → 402 đúng `accepts[]`, đúng amount, đúng asset, đúng payTo.
- Paid đúng → 200 + tx hash thật trên Snowtrace, balance seller tăng đúng.
- Paid sai amount / sai payTo / nonce đã dùng / hết hạn 60s → fail,
  không serve kết quả đã giữ.
- Upstream fail → không charge, operation FAILED.
- Over per-call cap / tool lạ → không ký, audit ghi BLOCK.
- Idempotency: cùng operationId + cùng input → cùng receipt, không
  charge hai lần; cùng operationId + input khác → 409.
- TalkMeter: tick trùng phút → receipt cũ; tick phút tương lai → reject.
- Reservation: spent + reserved không vượt tool cap khi gửi concurrent.
- Mock mode ghi MOCK, live mode có tx hash — không lẫn hai mode.
