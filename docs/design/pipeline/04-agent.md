# 04 — Proposer, validator và audit/proof

## 1. Vai trò và intent

LLM chỉ đề xuất JSON, không nhận private key, không gọi signer trực tiếp, không đổi policy/mission.
Owner ký mission qua 05; signer/backend deterministic code mới quyết định sử dụng key A.
LIVE_LLM hoặc SCRIPTED là nguồn proposal; LIVE_FUJI hoặc MOCK là mode payment riêng.
Scripted vẫn phải đi qua cùng validator, reservation, contract và receipt verifier.

Schema discriminated union (strict, reject unknown keys):
```json
{
  "kind": "tool_purchase",
  "mission_id": "mission-demo-01",
  "tool_id": "tool:summary",
  "amount_atomic": "500000",
  "reason": "Summarize the selected source",
  "arguments": {"text": "Selected source text"}
}
```
Treasury variant: kind=treasury_payout, mission_id, to (full EVM address), amount_atomic, reason; không tool_id.
Tool arguments là object theo schema từng tool ở 02, không phải arbitrary URL/code.
operationId do orchestrator tạo ngoài LLM output, không được LLM thay đổi khi retry.
amount_atomic positive integer <= uint256; reason UTF-8 <= 200 bytes, không newline/control chars.
Schema không check caps; policy mới route. Normalize address lowercase để so, chấp nhận lower-case address hợp lệ,
mixed-case sai checksum reject. Không so prefix, không ENS/tên/địa chỉ rút gọn.
Không cắt ngầm reason/input. Mission từ token phải khớp mission_id; mismatch reject.

## 2. Thứ tự validator

BLOCK trước, kiểm tra đủ hard trước khi kết luận QUEUE:
1. Schema/kind/arguments hợp lệ; treasury kind chỉ từ S2.
2. Spend credential đúng deployment/stage/authVersion/mission/agent/configVersion (05).
3. Mission tồn tại, còn hạn, ACTIVE; S2 treasury đọc chain. Owner/agent phải khớp.
4. Pause/maintenance false; S1 DB flag, S2 guard; dependency lỗi → fail closed.
5. Treasury recipient full-match allowlist, nonzero; lookalike là reason chi tiết của cùng check, không rule chạy sau revert.
6. Tool catalog/seller/origin/price/token/resource đúng config; terms snapshot bất biến; không approve/arbitrary calldata.
7. Velocity và input/provider limits; tool price phải <= cả per-call cap và available (cap-spent-reserved).
   So cả amount sắp chi, không chỉ kiểm tra budget đã chạm cap hay chưa.
8. Treasury max uint không phải đường approve; giao thức chỉ expose USDC transfer, không approve/call tùy ý.

Nếu treasury hard pass, QUEUE theo thứ tự perTx → UTC daily → mission treasury. Còn lại gọi propose.
Validator quyết định dự kiến; contract re-evaluate theo state chain hiện tại mới là kết quả cuối.
Một queue dự kiến có thể đổi route vì transaction khác đã thay spent/policy; UI đọc receipt thật.
Tool không có queue; muốn tăng budget thì owner tạo mission mới/cập nhật có chữ ký, không auto top-up.
Mission token không đủ để thực thi sau expiry/pause. Retry payment đã ký/recovery đọc xử lý theo 02/05,
không áp preflight spend mới để cấm trả kết quả đã thanh toán.

## 3. Mission và treasury request

Mission do owner tạo, không LLM. S1 off-chain; S2 createMission trên guard rồi mirror DB.
Mỗi mission hai cap riêng, một tool ledger; owner chỉ được tăng/giảm tool cap khi cap >= spent+reserved và phải tăng configVersion.
MVP không cần UI edit tool cap: tạo mission mới có chủ ý là đủ, không tái dùng slug hay reset spent.
Mission expiry/close chặn request/reserve/sign mới. Pending authorization vẫn phải reconcile và accounting.
Treasury proposal bắt buộc nonzero mission, đúng agent, chưa expired/closed. Soft override không mở lại mission hết hạn.
Treasury requestId encode bytes32 bằng 16 bytes zero prefix + 16 bytes UUID theo hex order (bỏ dấu gạch UUID);
ví dụ 00112233-4455-6677-8899-aabbccddeeff → 0x0000000000000000000000000000000000112233445566778899aabbccddeeff.
App/contract fixtures phải dùng đúng encoding này, không hash UUID lại hay pad về phía khác.
Contract lưu unique mission+requestId để HTTP retry không auto-transfer hai lần (01); DB intent 05 dùng cùng ID.
Không nhận EOA nonce mới để "thử lại" khi broadcast outcome UNKNOWN.

## 4. Human queue

Queue phải có proposal/event on-chain, DB chỉ mirror.
O ký approve rồi execute riêng bằng MetaMask; execute check hard/expiry hiện tại.
Approved không tự chuyển tiền, không reset expiry, không auto chạy khi nới cap.
Owner UI hiển thị amount/recipient/mission/cap hiện tại, queueReason và policyVersionAtPropose;
giải thích số có thể vượt soft cap sau owner override, không giấu overBy.
Record API chỉ ghi sự kiện đã verify receipt success/finality; duplicate webhook/client record idempotent.
Reject hỗ trợ Queued/Approved; expire không cần keeper để khiến approve/execute hết hiệu lực.

## 5. Audit canonical encoding và concurrent append

Dùng canonical object với toàn bộ key cố định sorted lexicographically, values là strings, null → "",
UTF-8 JSON.stringify compact. Không có nested unnormalized objects trong entry.
Keys:
`actor, amount, chain_id, created_at, kind, mission_id, operation_id, policy_hash, policy_version,
prev_hash, reason, result_hash, rule, source_key, to, tx_hash`.
Timestamp là UTC ISO milliseconds đã persist. Atomic amounts integer string, addresses/hash lowercase.
entryHash = keccak256(UTF8(canonicalJson)); prev_hash đầu là 32 zero bytes.
SourceKey = chain:txHash:logIndex cho event; operationId:transitionVersion cho payment; UUID cho pre-sign block.
Kinds: PROPOSED, QUEUED, APPROVED, EXECUTED, REJECTED, EXPIRED, BLOCKED,
TOOL_RESERVED, TOOL_SIGNED, TOOL_PAID, TOOL_FAILED, TOOL_UNKNOWN, PAUSED, UNPAUSED, CUTOVER.
Settlement-after-pause là reason/marker của TOOL_PAID, không đổi terminal SETTLED và không cộng accounting lần nữa.

Append dưới AuditHead row lock, cập nhật head và insert cùng transaction với quyết định DB tương ứng.
Không dùng sequence id như bằng chứng không thiếu entry; sequence có thể có gap do rollback.
Đối với chain events, sourceKey unique + receipt verified trước ingest. Backfill missed events.
Blocked trước sign có tx_hash rỗng; revert có thể có tx receipt nhưng không có event Blocked.
DB/RPC lỗi không được tự tạo fabricated blockchain evidence.

Verifier độc lập đọc JSON export + checkpoint, không yêu cầu DB URL/private secret.
Kiểm tra canonical bytes/hashes/order/head/entry count/sourceKey uniqueness, result hash khi owner cung cấp result bytes;
chain receipt binding đối chiếu bằng RPC khi online. API verify chỉ convenience cùng algorithm.
Public checkpoint: commit SHA + headHash + entry count + schemaVersion của export cụ thể trong evidence/.
Hash chain không chứng minh operator chưa viết lại history trước checkpoint; không chứng minh answer quality.
Public proof export phải dùng field allowlist, không dump ORM row hay private input/heldResult/signature/token.
Owner private proof chứa result để recompute hash; public bundle chỉ resultHash trừ khi owner chọn publish demo result.

## 6. Proof bundle và business result

Một bundle có mission/config snapshot, requested intent/hash, policy snapshot/hash, route reason,
operation/requestId, authorization-to-receipt binding (public fields), resultHash nếu tool,
audit entry/checkpoint và feedback reference nếu có.
Treasury không có tool result: resultHash null đúng nghĩa, không bịa.
Policy version số đơn độc không đủ: lưu actual caps/allowlist relevant entry, block reference và tool config snapshot.
On-chain rejection chứng minh contract rule cho input đó; off-chain BLOCK là nhật ký backend, không gọi là on-chain attestation.
S3 demo phải có mission deliverable search → summary thật; ít nhất một successful purchase có receipt và result.
Không dùng một SETTLED payment như bằng chứng toàn mission đã hoàn thành; completion do owner xác nhận (03).

## 7. Threat boundaries

- Prompt injection: allowlist/caps chặn unauthorized spend nhưng không hiểu được mọi chi vô ích trong policy.
- Agent key compromised: attacker bỏ qua auth/validator/DB tool caps, rút tool wallet và mọi refill;
  pause chỉ chặn server route. Không auto-refill, refill chỉ do O ký transfer trực tiếp bằng ví riêng, không treasury payout về A trong MVP.
- Treasury key A vẫn chỉ propose trong active missions/allowlists; UTC day caps áp dụng mỗi ngày,
  nhiều mission phải tính aggregate, owner override ngoài giới hạn auto.
- Owner key compromised/owner malicious: ngoài guarantee của guard (set policy, approve và withdraw).
- Tool/facilitator malicious: signature không đổi amount/payTo; không bảo đảm tool quality, latency hay availability.
  Results/payment recovery có thể UNKNOWN khi thiếu evidence; không hứa fair exchange tuyệt đối.
Claims/test dùng cùng payload và scope; không extrapolate "0 funds lost" từ vài attack case.
