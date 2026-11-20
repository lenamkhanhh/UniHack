# 02 — x402 tool payments: quote, authorization, settlement, recovery

**Owner của spec payment.** Constants ở [00](00-overview.md), DB/auth ở [05](05-app.md), acceptance ở [06](06-tests-security.md).
Mọi trạng thái dưới đây là yêu cầu implement, chưa phải kết quả đã chạy.

## 1. Protocol và facilitator

MVP dùng x402 v1, scheme `exact`, USDC Fuji, EIP-3009. Pin client/server SDK version cùng protocol.
S0 phải ghi SDK versions, facilitator, `/supported`, network/token và một tx thật.
Nếu chỉ có v2 hoạt động, đổi client/server/header/schema cùng lúc, cập nhật manifest và chạy lại payment tests; không trộn phiên bản.

Thử Ultravioleta `https://facilitator.ultravioletadao.xyz`, rồi Thirdweb, cuối cùng x402-rs tự host bằng test key.
Fallback chỉ đổi sau khi reconcile authorization đang outstanding; không tạo payment mới vì facilitator cũ timeout.
Một facilitator hỗ trợ network không chứng minh settlement đã chạy. x402 có nhiều chain, không quảng cáo là công nghệ chỉ có trên Avalanche.

## 2. Catalog và wire contract

| ID | Giá atomic USDC | Input / output | Giới hạn |
|---|---:|---|---|
| `tool:search` | 100000 | query giới hạn 500 ký tự → 3 ý và URL nguồn | Per-call 0.10 USDC |
| `tool:summary` | 500000 | text ≤ 2000 ký tự → summary ≤ 500 ký tự | Per-call 0.50 USDC |
| `tool:talkmeter` | 50000 | một phút đã hoàn thành của session mô phỏng | 0.05/phút; 2.00/session |

Seller, origin/path, price, token và facilitator lấy từ server config, không từ LLM.
Chặn redirect tự động tới origin lạ; không chuyển mission token/API secret sang seller ngoài allowlist.
Input là dữ liệu, không có quyền thay policy.

Ví dụ response unpaid đầy đủ cho v1 (SDK phải serialize đúng transport):
```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "avalanche-fuji",
    "maxAmountRequired": "500000",
    "asset": "0x5425890298aed601595a70AB815c96711a31Bc65",
    "payTo": "<configured-seller>",
    "resource": "https://<configured-origin>/api/tools/summary",
    "description": "Summarize a short document",
    "mimeType": "application/json",
    "maxTimeoutSeconds": 60,
    "extra": {"name": "USD Coin", "version": "2"}
  }]
}
```

Paid retry dùng `X-PAYMENT`: base64 JSON gồm `x402Version, scheme, network, payload: {signature, authorization}`.
Authorization chứa `from, to, value, validAfter, validBefore, nonce`; dùng đúng EIP-712 domain chain/token.
Nonce là CSPRNG 32 bytes; TTL ≤ 60s. Chọn validAfter theo thời gian chain với clock-skew allowance của SDK;
không dùng server wall-clock tương lai khiến authorization chưa hợp lệ. Không dùng approve(max).
`200` sau settlement kèm `X-PAYMENT-RESPONSE` do SDK tạo và tx hash đã xác minh.
`X-Operation-Id` là extension của app, không phải field được chữ ký EIP-3009 tự ràng buộc.

## 3. Operation identity và các trạng thái

Identity bất biến: `(deploymentId, mission, operationId, payer, toolId, inputHash, paymentTermsHash)`.
`operationId` UUID do caller tạo, global unique trong DB deployment. Mission lấy từ credential, payer từ agent key.
Canonical input: object keys cố định theo tool, UTF-8, không trim/sửa text có ý nghĩa ngầm; hash đúng bytes đã dùng.
Terms snapshot gồm protocolVersion, scheme, chain, token, atomic price, payTo, resource, timeout và policy version.
Retry dùng terms đã lưu; config giá mới không được viết lại operation cũ. Re-check policy trước khi ký mới.

| State | Ý nghĩa |
|---|---|
| CREATED | Quote có trong DB, chưa reserve, chưa ký, chưa chạy upstream |
| RESERVED | Đã giữ budget, chưa có authorization được phát hành |
| SIGNED | Authorization duy nhất đã lưu bền vững, có thể được phát hành/settle |
| SUBMITTING | Submission intent đã ghi trước network call; có thể đã submit dù mất response |
| SETTLING | Biết candidate tx hash, chờ receipt/finality |
| UNKNOWN | Chưa đủ bằng chứng kết luận; giữ reservation |
| SETTLED | Payment đúng đã xác minh; reservation chuyển thành spent đúng một lần |
| FAILED | Không còn payment hợp lệ có thể settle; reservation đã giải phóng đúng một lần |

Không cần thêm state cho upstream: `heldResult`, `heldResultHash`, `failureReason`, worker lease ghi tiến độ.
FAILED và SETTLED là terminal; retry không revive operation. Bắt đầu mua mới phải dùng ID mới sau terminal.
SIGNED/SUBMITTING không được coi như RESERVED khi process restart.

## 4. Flow duy nhất từ unpaid đến kết quả

1. Xác thực spend credential, mission ACTIVE/còn hạn, pause, catalog/input và limits trước mọi công việc tốn tiền.
   Tạo CREATED và trả 402 + operationId; chưa compute upstream, chưa giữ budget. Quote có expiry riêng.
2. Orchestrator của app gọi reserve trước khi dùng agent signer. Trong transaction lock mission rồi session (nếu có),
   kiểm tra `price <= cap - spent - reserved` cho cả mission/session, unique ID/tick, policy và quote expiry;
   tạo RESERVED, tăng reserved, đặt `reservationExpiresAt = now + 60s`.
3. Signer chỉ ký sau reservation. Một operation chỉ một authorization. Lưu toàn bộ authorization/signature và
   chuyển RESERVED → SIGNED bằng compare-and-set dưới operation lock trước khi gửi signature ra ngoài.
   Nếu expiry worker đã giải phóng reservation, signer bỏ signature chưa phát hành, không submit.
   Nếu signer thắng trước, expiry worker thấy SIGNED và không giải phóng. Không log signature.
4. Seller/resource handler verify proof và binding trước khi chạy upstream. Duplicate workers phải claim lease
   bằng DB compare-and-set; không chạy lại upstream cho cùng operation chỉ vì request retry.
   Persist heldResult + hash trước settlement. Upstream lỗi thì không gọi settle.
   Worker lease có fencing/version check khi ghi result; một heldResult đã chốt không bị worker cũ overwrite.
   Search/summary là upstream có thể retry trước khi persist result sau crash; không claim exactly-once execution
   của provider ngoài hệ thống. Guarantee là một payment/receipt cho operation, không phải provider không bao giờ
   bị gọi lại. MVP không dùng upstream có side effect tài chính không đảo ngược.
   Nếu đã SIGNED, lỗi upstream vẫn giữ reservation tới khi authorization hết hiệu lực và reconcile;
   không giả định signature đã phát hành không còn nguy cơ bị dùng.
5. Trước external settle call, persist SUBMITTING + attempt metadata. Không giữ DB row lock xuyên network call.
   Ack có tx hash → SETTLING; mất ack → UNKNOWN. Crash ở SUBMITTING → recovery, không tạo nonce mới.
6. Receipt verifier ở §6 quyết định SETTLED/FAILED/UNKNOWN. Chỉ trả heldResult khi SETTLED.
   Settlement và response delivery là hai việc: response mất thì owner lấy lại heldResult, không trả tiền lần nữa.

MVP có thể đặt client orchestrator và seller handler trong cùng Next.js app nhưng phải giữ rõ hai vai,
không đưa private key vào frontend. External clients vẫn phải tuân thủ reserve/auth của demo này;
không nhận payment rồi gán đại vào một mission.

## 5. Reservation, idempotency và crash safety

- Lock order cố định: mission → session → operation → audit head. Dùng transaction ngắn, retry bounded khi deadlock/serialization fail.
- Atomic check-and-reserve, immutable authorization, terminal accounting và audit/outbox phải được DB bảo đảm;
  hai HTTP workers không được cùng chuyển reserved → spent hoặc cùng release.
- Retry cùng ID/scope trả state/quote/result cũ. Khác scope → 403/409, không overwrite record.
- `@@unique([chainId, asset, authFrom, authNonce])` ngăn một authorization nhận credit cho hai operation.
  Không tái dùng nonce cho operation khác ngay cả khi operation FAILED.
- CREATED quote hết hạn → FAILED, không accounting. RESERVED hết hạn và `authNonce IS NULL` →
  FAILED + release dưới cùng lock. Đây là pre-authorization timeout, không cần RPC.
- SIGNED/SUBMITTING/SETTLING/UNKNOWN không release chỉ vì wall-clock/mission expiry, pause hoặc token expiry.
  Giữ reserved kể cả mission đã đóng. Atomic terminal transition mới release hoặc convert.
- Không cho tự tạo operation mới từ retry chưa rõ kết quả. Một explicit purchase mới vẫn được phép nếu còn budget;
  UI phải phân biệt nó với recovery. Reservation cũ luôn còn được tính.
- DB/RPC unavailable: chặn reserve/sign mới; không biến lỗi hạ tầng thành SETTLED/FAILED.
- Audit/result không được reset/xóa để chạy demo lại. Tạo mission/session mới, giữ receipts cũ.
- Lazy reconcile trên operation GET và retry là bắt buộc; worker định kỳ là optional.
  RPC down lâu → UNKNOWN, cảnh báo/manual inspect; không có nút force-release khi authorization còn rủi ro.

## 6. Reconcile và bằng chứng settlement

`authorizationState` là tín hiệu, không phải receipt. Không dùng riêng nonce=true hoặc Transfer cùng amount để credit.
Dùng RPC cùng chain; đọc nonce và timestamp tại cùng finalized/accepted block snapshot.
Pin finality rule trong deployment manifest (ưu tiên RPC finalized nếu Fuji provider hỗ trợ, nếu không phải ghi
quy tắc confirmation/finality đã xác minh lúc spike). Không gọi block latest chưa final là bằng chứng cuối cùng.

SETTLED cần tất cả:
- Receipt status success và block đạt finality rule, tx thuộc đúng chain.
- Log phát ra từ đúng USDC token, AuthorizationUsed khớp `(authFrom, authNonce)`.
- Transfer trong cùng transaction từ đúng payer → đúng payTo, đúng authValue.
- Nếu đã có facilitator tx hash thì đối chiếu; hash khác phải reconcile/giải thích bằng chain evidence, không tự gán.
- Verifier không gán một payment/nonce cho hai operation. Lưu blockHash, blockNumber, log indices và nonce binding.

Nếu ABI deploy không có AuthorizationUsed: chỉ dùng adapter có thể chứng minh calldata/trace + Transfer đúng authorization,
pin adapter và acceptance riêng. MVP ưu tiên ABI có event; chưa có proof tương đương → UNKNOWN, không đoán.
Một Transfer cùng payer/payTo/amount có thể thuộc giao dịch khác nên không đủ.

FAILED chỉ khi:
- Pre-authorization timeout/failure chắc chắn chưa phát hành authorization; hoặc
- AuthorizationCanceled đúng nonce/token trên finalized chain; hoặc
- Finalized block timestamp >= validBefore và nonce=false tại cùng block.
Một receipt reverted không tự vô hiệu chữ ký; authorization vẫn có thể được submit lại trước expiry.
Nonce=true nhưng chưa phân biệt được Used/Canceled → UNKNOWN. Finalized expiry + nonce=true vẫn phải tìm payment/cancel.
SETTLED không phụ thuộc còn spend token; quyền đọc/reconcile tách ở 05.

Nguồn: [Circle ERC-3009](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol),
[ERC-3009](https://eips.ethereum.org/EIPS/eip-3009),
[x402 v1](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md).
Cửa sổ valid là `block.timestamp > validAfter && block.timestamp < validBefore`.

## 7. TalkMeter và pause

Session bind mission, payer, immutable rate/cap, server startedAt. Đây là simulated session, không claim ghi âm.
Tính completedMinutes = floor((serverNow - startedAt)/60). Chỉ có billable index `0 <= i < completedMinutes`.
Minute 0 chỉ được tính sau đủ 60 giây; tick tại 59 giây không charge.
Server chọn index nhỏ nhất chưa được tạo, không cho client tùy ý tăng phút; DB unique(sessionId, minuteIndex).
Duplicate tick trả cùng operation/state/receipt, không charge lại. Retry sau Stop vẫn đọc được receipt đã có;
Stop cấm tạo phút mới và ghi stoppedAt, không xóa outstanding operation. Không backfill phút chưa mua sau Stop.
MVP từng completed minute một, không channel/upto, không real mic. Cap 2 USDC; không âm thầm gộp fee summary vào phút.

Pause chặn quote/reserve/sign mới qua API. Authorization đã ký vẫn có thể settle trước expiry.
Outstanding exposure qua server <= tổng reserved của authorization có thể settle, không phải "một authorization/tool/phút".
Key holder ngoài server không bị pause DB/guard chặn x402; xem threat model 06.
Settlement xác nhận sau pause vẫn accounting, audit thêm marker SETTLED_AFTER_PAUSE; không chuyển terminal state khác.

## 8. HTTP và acceptance

- 400 schema; 401 thiếu/invalid credential; 403 sai mission/payer; 409 scope conflict; 402 payment required;
  202 pending/reconciling; 503 dependency unavailable. Không dùng 402 như lỗi upstream hay bằng chứng settlement fail.
- Paid retry SIGNED/SUBMITTING/SETTLING/UNKNOWN: trả state + recovery URL, không ký mới.
- GET operation/result cần read hoặc spend credential có đúng scope (05). Unknown ID/scope: response chung,
  không lộ tồn tại/state/heldResult/authSignature. Nonce có thể công khai on-chain nhưng API không cần phát lộ.
- Mock luôn ghi MOCK, không có tx hash giả. Scripted proposer có thể dùng live Fuji, badge tách khỏi payment mode.
- Toàn bộ test payment P-series trong 06 bắt buộc từ S1; chưa có implementation thì không đánh dấu pass.
