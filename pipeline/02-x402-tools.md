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
- Pause (S1: flag DB, S2: guard paused) → TalkMeter tick cũng dừng (pre-flight check paused, nguồn pause theo stage, xem 05 §4b).

## 6. Pre-flight cho tool payment — 5 luật, chạy trước mọi lần ký

Chạy ở server, bằng code, không bằng prompt (chi tiết full ở 04 §3).
**Tool payment không có human queue trong MVP** — đây là hành vi
duy nhất, đồng bộ với 04 §3. Nếu một tool purchase cần người duyệt,
cách đúng là duyệt một treasury payout để nạp tiền vào ví tool của
agent trước, rồi tool payment mới chạy; không queue chính tool
payment đó.

1. `kill_switch`: paused → không tạo reservation mới, không ký. Nguồn pause theo stage: S1 = flag DB, S2 = guard `paused()` (xem 05 §4b).
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
GET  /api/tools/operations/:operationId -> trạng thái operation + txHash nếu có, yêu cầu mission token đúng mission (xem §9.7)
```

**Lỗi trả về phải rõ:** `402` = chưa trả tiền, `402` lại sau khi
settle fail = trả lại, `403` = tool không allowlisted, `409` =
operationId dùng lại với input khác, `503` = paused hoặc facilitator
down. Đừng trả `500` chung cho mọi thứ rồi để giám khảo đoán.

## 9. x402 lifecycle, idempotency và reservation — bắt buộc, không phải nâng cao

### 9.1. Operation, trạng thái và dữ liệu phải lưu (persistence)

Mỗi lần mua tool là một operation. Operation identity đầy đủ là
bộ 6 (xem §9.7): (mission, operationId, payer, tool, inputHash,
paymentTermsHash). Client tạo UUIDv4, gửi header `X-Operation-Id`
ở cả request chưa trả tiền và request đã trả tiền. Nếu client
không gửi, server tạo một ID và trả về trong 402 — nhưng lúc đó
retry mà không gửi lại ID đó sẽ tạo operation mới, không được
idempotency.

Server lưu operation trong DB (schema đầy đủ ở 05 §3), **không**
lưu trạng thái hay held result trong bộ nhớ:

- Identity/scope: `missionSlug`, `missionIdBytes32`, `operationId`,
  `payerAddress` (agent address), `toolId`, `inputHash` (hash của
  input đã normalize: query/text đã trim, không chứa secret),
  `paymentTerms` (price, asset, payTo, network, scheme,
  maxTimeoutSeconds, dạng JSON), `paymentTermsHash`.
- Authorization (server-only, không bao giờ trả ra frontend):
  `authNonce`, `authFrom`, `authTo`, `authValue`, `validAfter`,
  `validBefore`, `authSignature` (v/r/s).
- Held result: `heldResult` (kết quả tool đầy đủ, dạng JSON/text)
  và `heldResultHash`. Held result phải được ghi vào DB **trong
  cùng transaction** với reservation, trước khi 402 được phát hành.
  Nếu ghi held result thất bại thì không có RESERVED, không có 402.
  Held result sống cùng vòng đời operation, không phải TTL bộ nhớ
  ngắn — server restart giữa RESERVED/SETTLING/UNKNOWN vẫn phải
  trả lại đúng kết quả đã giữ sau khi settlement xác nhận.
- Recovery: `facilitatorName`, `facilitatorTxHash` (nếu facilitator
  đã ack), `lastReconciledAt`, `reconcileCount`,
  `lastReconcileBlockTimestamp`, `state`, `reservedAmount`,
  `txHash`, `sessionId`, `minuteIndex` (chỉ TalkMeter), `createdAt`.

Trạng thái, theo đúng thứ tự này:

```
CREATED     — 402 đã phát hành, chưa có reservation, chưa có payment
RESERVED    — upstream đã chạy nội bộ thành công, kết quả đã giữ
              trong DB, budget đã trừ vào reserved, chờ client trả tiền
SIGNED      — đã nhận X-PAYMENT, authorization verify pass, chưa settle
SETTLING    — facilitator đã ack submission (có tx hash), đang chờ receipt
SETTLED     — settlement confirmed bằng receipt, kết quả đã giữ được trả, reserved → spent
FAILED      — upstream lỗi, verify lỗi, settle lỗi đã reconcile, hoặc
              authorization hết hạn đã reconcile (xem §9.4)
UNKNOWN     — facilitator timeout / response mất, chưa có ack, chưa biết
              đã submit hay chưa — giữ nguyên trạng thái và reservation
              cho tới khi reconcile xong theo §9.4, không tự chuyển FAILED
```

### 9.2. Budget và reservation atomic

Budget khả dụng cho mission tool cap và cho session cap tính như sau:

```
available = cap − spent − reserved
```

- Reservation tạo khi chuyển sang RESERVED, với amount = giá tool.
- Reservation **atomic, bắt buộc**: một DB transaction duy nhất —
  lock row mission (`SELECT … FOR UPDATE` trong transaction
  Postgres), đọc spent/reserved, check available, rồi mới tạo
  operation RESERVED và tăng `reservedTool`. Không có lock thì hai
  operation khác nhau gửi đồng thời có thể cùng pass check rồi
  cùng trừ, vượt cap — đó là lỗi, không phải race hiếm.
- Reservation **không** hết hạn chỉ vì wall-clock vượt 60s.
  Reservation được giải phóng khi và chỉ khi operation chuyển
  sang FAILED sau khi đã reconcile trên chain (xem §9.4), hoặc
  chuyển thành spent khi SETTLED. Không có đường giải phóng nào
  khác.
- Reservation chuyển thành spent khi SETTLED, không cộng hai lần.

### 9.3. Retry và idempotency — không ký payment mới bừa

Retry phải khớp **toàn bộ scope**, không chỉ operationId + input:

- Lookup chính là (missionSlug từ token, operationId). Đồng thời
  check index global: operationId đã tồn tại ở mission khác →
  `409` cross-mission reuse, không tạo operation mới.
- Cùng mission + operationId + cùng inputHash + cùng payment terms
  + cùng payer:
  - Đang RESERVED → trả lại 402 cũ (cùng amount, payTo, asset).
  - Đã SETTLED → trả lại kết quả cũ + tx hash cũ, không ký mới
    (và chỉ trả khi caller có quyền, xem §9.7).
  - Đang SETTLING/UNKNOWN → không ký mới, trả trạng thái hiện tại
    và hướng dẫn gọi recovery (xem §9.4).
- Mission khác, hoặc payer khác (`auth.from` ≠ mission agent ≠
  operation payer) → `403`, không settle, không tạo operation mới.
- Input khác, hoặc payment terms khác (amount, payTo, asset,
  network, scheme) → `409`, không chạy.
- Operation khác nhau nhưng cùng input thì là hai lần mua riêng —
  idempotency chỉ theo (mission, operationId, scope), không theo
  input đơn thuần.

### 9.4. Recovery khi settlement UNKNOWN — ngăn charge hai lần và ngăn trả kết quả miễn phí

Khi facilitator timeout hoặc response mất:

1. Không ký authorization mới, không tạo operation mới cho cùng
   việc đó. Operation giữ nguyên UNKNOWN và giữ reservation.
2. Phân biệt SETTLING và UNKNOWN: SETTLING đã có facilitator tx
   hash → poll receipt của tx đó. UNKNOWN chưa có tx hash → chưa
   biết đã submit hay chưa, không được suy ra từ nonce.
3. **Nonce chưa dùng không chứng minh payment thất bại.** Nonce
   chưa dùng chỉ có nghĩa là tại thời điểm check, authorization
   chưa được tiêu thụ — facilitator vẫn có thể submit nó trước
   `validBefore`. Vì vậy: nếu block timestamp mới nhất trên chain
   chưa vượt `validBefore` thì giữ UNKNOWN, không chuyển FAILED,
   không giải phóng reservation, không cho client bắt đầu lại bằng
   authorization mới cho cùng việc (authorization mới sẽ là một
   operation mới, nhưng operation cũ vẫn giữ reservation cho tới
   khi reconcile — client phải chờ reconcile, không được double-spend
   ngân sách bằng cách tạo operation mới lén).
4. **Nonce đã dùng không chứng minh payment thành công.** Theo
   EIP-3009, nonce chuyển `false → true` qua cả transfer, receive,
   **và cancel** (`cancelAuthorization` đánh dấu nonce đã dùng mà
   không chuyển tiền). Vì vậy nonce đã dùng chỉ là tín hiệu để đi
   tìm receipt, không phải bằng chứng settlement.
5. **Chỉ chuyển SETTLED khi có receipt xác nhận:** tx receipt có
   Transfer từ payer tới payTo đúng amount, với tx hash khớp
   facilitator tx (nếu có), và/hoặc event AuthorizationUsed cho
   (authorizer, nonce) nếu contract deploy emit nó. Nếu tìm thấy
   event AuthorizationCanceled cho (authorizer, nonce) thì chuyển
   FAILED (authorization đã bị hủy, không có transfer).
6. **Không tra được receipt/event nào → giữ UNKNOWN.** Không trả
   kết quả đã giữ (trả kết quả khi chưa chắc đã trả tiền là cho
   miễn phí), không giải phóng reservation, không bịa tx hash.
   Trường hợp này cần đối chiếu thủ công (facilitator dashboard /
   Snowtrace) và ghi audit rõ là `UNKNOWN — manual reconciliation
   required`.
7. **Chỉ chuyển FAILED khi đã reconcile xong:** block timestamp
   mới nhất trên chain đã vượt `validBefore` (so bằng block
   timestamp, không phải wall-clock server — cửa sổ EIP-3009 là
   `block.timestamp > validAfter` và `block.timestamp < validBefore`,
   strict) **và** tại thời điểm đó nonce vẫn chưa dùng. Lúc đó
   mới giải phóng reservation, client mới được bắt đầu operation
   mới cho cùng việc.
8. Reconcile được kích hoạt khi: client gọi
   `GET /api/tools/operations/:operationId`, client retry operation
   đang UNKNOWN, hoặc server tự chạy reconcile định kỳ (nếu có —
   không bắt buộc cho MVP, nhưng lazy reconcile ở hai điểm trên
   là bắt buộc). Mỗi lần reconcile ghi `lastReconciledAt`,
   `reconcileCount`, `lastReconcileBlockTimestamp` vào operation.
9. Endpoint `GET /api/tools/operations/:operationId` là nơi duy
   nhất client tra trạng thái recovery, và nó kiểm tra quyền theo
   §9.7 — không token đúng mission thì không được biết trạng thái.

### 9.5. TalkMeter: unique (sessionId, minuteIndex), phút tính bằng server, session bind mission

- `minuteIndex = floor((serverNow − startedAt) / 60)`, phút 0 là
  phút đầu tiên. Client không được gửi minuteIndex.
- Session tạo dưới mission token nào thì tick/stop phải dùng đúng
  token mission đó. Tick với token mission khác → `403`.
- DB unique constraint trên `(sessionId, minuteIndex)`. Tick trùng
  phút đã trả → trả receipt cũ, không ký mới. Tick đồng thời cùng
  phút → một tick thắng unique constraint, tick còn lại nhận
  receipt của tick thắng.
- Tick cho phút tương lai (theo server time) → reject. Tick sau khi
  session đã stop/capped → reject. Tick khi session cap đã chạm →
  session chuyển CAPPED, không ký thêm.
- TalkMeter cũng là operation x402 bình thường: mỗi phút là một
  operation riêng, với `operationId` riêng, để idempotency và
  recovery áp dụng y hệt, và operation đó cũng bind mission theo §9.7.

### 9.6. Pause và authorization đã ký — giới hạn phải nói đúng

- Pause chặn: reservation mới, pre-flight mới, ký mới **qua server API**.
- Pause **không** thu hồi authorization đã ký và còn trong 60s TTL.
  Authorization đó vẫn có thể settle trước `validBefore`.
- Pause cũng **không** chặn attacker giữ agent private key ký trực
  tiếp ngoài server (xem 06 §5, mục key compromise). Pause là kill
  switch cho luồng qua server, không phải freeze ví agent.
- Rủi ro tồn đọng tối đa qua server: một authorization / tool /
  phút, TTL 60s, per-call cap, và reservation đã trừ vào tool cap —
  không phải rủi ro không giới hạn. Rủi ro qua key lộ là riêng,
  tính theo số dư ví tool (xem 06 §5).
- Settlement nào rơi vào sau thời điểm pause phải ghi audit là
  `SETTLED_AFTER_PAUSE`, kèm thời gian pause và tx hash, không
  được giấu trong audit chung.

### 9.7. Operation binding và quyền truy cập recovery/result

- Operation identity đầy đủ: (missionSlug, operationId, payer,
  toolId, inputHash, paymentTermsHash). Mọi endpoint operation
  đều phải check đủ bộ này, không chỉ operationId.
- Paid retry: mission lấy từ token (không từ body), payer lấy từ
  `auth.from` và phải bằng mission agent và bằng operation payer,
  tool lấy từ path, inputHash tính lại từ input, payment terms
  lấy từ authorization và phải khớp operation đã lưu. Khác scope →
  `403` (mission/payer) hoặc `409` (input/payment terms), không settle.
- `GET /api/tools/operations/:operationId` và việc trả held result
  sau SETTLED đều yêu cầu mission token của đúng mission của
  operation đó. Không token → `401` chung (không phân biệt "không
  tồn tại" với "không có quyền" bằng response chi tiết, và tuyệt
  đối không lộ held result hay tx hash). Token của mission khác →
  `403`.
- Server không bao giờ trả `authSignature`, `authNonce` chi tiết
  hay held result qua endpoint không có quyền. Các field server-only
  trong 05 §3 chỉ dùng nội bộ cho recovery.

## 8. Test bắt buộc cho x402 (chi tiết ở 06)

- Unpaid → 402 đúng `accepts[]`, đúng amount, đúng asset, đúng payTo.
- Paid đúng → 200 + tx hash thật trên Snowtrace, balance seller tăng đúng.
- Paid sai amount / sai payTo / nonce đã dùng / hết hạn 60s → fail,
  không serve kết quả đã giữ.
- Upstream fail → không charge, operation FAILED.
- Over per-call cap / tool lạ → không ký, audit ghi BLOCK.
- Idempotency + binding: cùng mission + operationId + input + payment
  terms + payer → cùng receipt, không charge hai lần; khác scope →
  403/409, không settle (xem §9.7).
- TalkMeter: tick trùng phút → receipt cũ; tick phút tương lai → reject.
- Reservation atomic: hai operation khác nhau gửi đồng thời không
  vượt tool cap (xem §9.2, test V13).
- Recovery: UNKNOWN giữ reservation tới khi reconcile xong trên
  chain; nonce chưa dùng không tự thành FAILED, nonce đã dùng không
  tự thành SETTLED (xem §9.4, test V14–V16).
- Restart: server restart giữa RESERVED/SETTLING/UNKNOWN vẫn trả
  đúng held result sau settlement, vì held result nằm trong DB
  (xem §9.1, test V17).
- Mock mode ghi MOCK, live mode có tx hash — không lẫn hai mode.
