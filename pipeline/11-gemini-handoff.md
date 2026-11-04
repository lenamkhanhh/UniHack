# 11 — Handoff cho Gemini (đọc trước khi code, không cần đọc hết 10 file mới code được)

**Sản phẩm chốt:** Guarded Agent Economy trên Fuji. Trục use case:
**một nhóm nghiên cứu / CLB giao agent một nhiệm vụ có ngân sách;
agent mua công cụ để hoàn thành nhiệm vụ đó; mọi khoản chi đối chiếu
được với quyền được cấp và kết quả nhận lại.**

## 1. Luồng tiền, nói trong 4 dòng

1. Owner tạo mission (slug, agent, treasury cap 10 USDC, tool cap
   5 USDC, expiry 24h) và kích hoạt bằng chữ ký.
2. Agent (LLM chỉ đề xuất JSON) → validator BLOCK/QUEUE → treasury
   payout qua guard on-chain, hoặc tool purchase qua x402.
3. Treasury vượt cap → queue, owner duyệt bằng MetaMask.
   Tool vượt cap → BLOCK, không queue.
4. Mọi quyết định vào audit ledger + proof bundle (mission →
   policy version → payment tx → result hash).

## 2. Invariants bắt buộc — phá invariant nào cũng là phá sản phẩm

- **I1. Mission bắt buộc.** Treasury payout S2 phải thuộc mission
  tồn tại, chưa hết hạn, chưa đóng, đúng agent. Không có payout
  ngoài mission. LLM không tạo mission.
- **I2. Schema ≠ policy.** Schema chỉ check hình dạng. Cap là policy.
  Treasury vượt cap → QUEUE, không phải schema lỗi.
- **I3. BLOCK trước QUEUE.** Mọi BLOCK check trước, rồi mới QUEUE
  (per-tx → daily → mission treasury). Tool không có queue.
- **I4. Hard không override, soft được owner duyệt.** Hard: paused,
  recipient không allowlisted, mission hết hạn/đóng, đã Executed/
  Rejected/Expired. Soft: 3 cap. Approve/execute check expiry trong
  hàm, không reset khi approve. Execute chỉ từ Approved, một lần.
- **I5. Owner ký bằng MetaMask, backend không giữ owner key.**
  Backend chỉ ký agent tx khi có mission token hợp lệ, và vẫn
  re-check mission ở mỗi call. Không tin address do client gửi.
- **I6. x402 idempotency + reservation atomic + binding.**
  Operation identity = (mission, operationId, payer, tool, inputHash,
  paymentTermsHash). Retry khác scope → 403/409, không settle.
  Budget khả dụng = cap − spent − reserved, reservation trong một
  DB transaction có row lock mission. Upstream chạy nội bộ, kết quả
  giữ **trong DB** trước khi phát 402, settle confirmed mới trả.
  UNKNOWN → không ký mới, không tự chuyển FAILED/SETTLED.
- **I7. Pause không thu hồi authorization đã ký trong 60s, và
  không chặn key holder ký trực tiếp.** Settlement sau pause ghi
  `SETTLED_AFTER_PAUSE`. S1 pause = flag DB, S2 pause = guard —
  xem 05 §4b, không dùng guard ở S1.
- **I8. ERC-8004 đúng ABI deploy.** `getSummary` 4 tham số,
  `readFeedback`/`readAllFeedback` (không có `getFeedback`).
  Feedback client là mission owner, chỉ sau operation SETTLED,
  tag MVP chỉ `starred` (quality). Không gọi là success rate.
- **I9. Storage deploy là Vercel + hosted Postgres.** Không dùng
  file SQLite local trên Vercel. Nếu DB down, hiển thị "audit DB
  unavailable", không hiển thị rỗng giả tạo.
- **I10. Claim đúng phạm vi.** Không nói "bị lừa cũng không mất
  tiền", không nói "0 mất" chung chung, không nói hash chain là
  trustless, không nói reputation chống Sybil. Câu đúng ở 00 §10
  và 04 §8.
- **I11. Nonce recovery đúng EIP-3009.** Nonce chưa dùng không
  chứng minh thất bại; nonce đã dùng không chứng minh thành công
  (có thể là cancel). Chỉ SETTLED khi có receipt Transfer đúng
  payer/payTo/amount; chỉ FAILED khi block timestamp đã vượt
  validBefore và nonce vẫn chưa dùng, hoặc có AuthorizationCanceled.
  Không giải phóng reservation vì wall-clock vượt 60s.
- **I12. LLM compromise ≠ key compromise.** LLM bị lừa thì validator
  còn chặn. Key agent bị lộ thì toolCap/allowlist off-chain không
  còn tác dụng — tổn thất tool tối đa = toàn bộ số dư ví tool +
  mọi lần refill trước khi đóng mission. Không auto-refill ví tool.
  Treasury vẫn được guard bảo vệ.
- **I13. Activation signature bind đủ.** Message đúng format 05 §4b
  (mission, agent, hai cap, nonce dùng một lần 10 phút, expiresAt =
  mission expiry, chain fuji-43113, domain = app origin). S1 verify
  bằng mission record, S2 thêm guard.owner() + mission on-chain
  khớp. Cutover S1→S2 phải làm checklist 05 §4b và kích hoạt lại token.
- **I14. Recovery/result có quyền.** GET operation và trả held
  result yêu cầu mission token đúng mission. Không token → 401
  chung, token sai mission → 403. Không lộ authSignature hay held
  result cho người không có quyền.

## 3. Thứ tự implementation (đồng bộ 08 §3)

1. S0 spike → ghi facilitator + x402 version thực tế.
2. **S1 trước:** tool server + TalkMeter + mission record off-chain
   + identity display + S1 submission pack (07 §4b).
3. **S2 sau:** guard contract (mission on-chain) + test C-series,
   rồi validator + mission token + queue MetaMask + audit.
4. **S3:** ERC-8004 feedback từ mission owner + proof bundle +
   verifier script + demo 6 scene + video + slides.
5. **S4 stretch theo 09:** policy replay simulation (off-chain) →
   attack replay → reputation tier → rolling cap → conditional
   approve → multisig/timelock. Dừng ở freeze 17/11.

## 4. Stage gates và fallback

- **S1 gate:** tool mua live, TalkMeter tick có tx, operation
  idempotency pass, S1 pack xong → có thể nộp ngay.
- **S2 gate:** C-series + V-series pass, queue MetaMask chạy,
  audit verify = true (API + script), attack có số trước/sau +
  positive control.
- **S3 gate:** feedback đọc lại được, proof bundle + verifier,
  video 2:30 đúng 6 scene, link mở được ẩn danh.
- **Fallback:** tới 17/11 mà S2 chưa xong → nộp S1, không nộp S2
  dở dang, và README/slides/video không claim phần chưa xây.

## 5. Test chạy ở đâu (đồng bộ 06)

- **C — forge:** `cd contracts && forge test` — guard, mission,
  state machine.
- **V — vitest/node:** validator, schema/policy, mission token,
  operation idempotency + binding, reservation atomic + concurrent,
  TalkMeter unique tick, audit hash, UNKNOWN/delayed settlement,
  nonce cancel, restart persistence, cross-mission reuse, S1 auth/pause,
  activation signature binding (V13–V21).
- **L — Fuji live:** x402 402→pay→200 thật, guard tx thật,
  ERC-8004 thật, TalkMeter tick thật — ghi tx hash vào README.

## 6. Quyết định đã chốt — không tự đoán lại

- Hằng số duy nhất ở 00 §8: Fuji 43113, USDC `0x5425…Bc65`,
  per-tx 5 USDC, daily 20 USDC (ngày UTC), mission treasury 10 USDC,
  mission tool 5 USDC, queue TTL 48h, x402 TTL 60s.
- Hai budget riêng, không gộp, không ghép x402 vào guard.
- Guard bỏ `toolAllowlist`, bỏ event `Blocked`, bỏ
  `emergencyWithdraw(to)` — chỉ rút về owner khi paused.
- Tool seller MVP không cần ERC-8004 identity.
- ERC-8004 là DRAFT — ABI deploy thắng EIP.
- Review-response đầy đủ ở `10-review-response.md`, gồm addendum
  lượt review nhỏ thứ hai (5 mục A1–A5, đều ACCEPT). Nếu spec
  khác nhau giữa các file, file có số lớn hơn và 10/11 thắng cho
  quyết định đã chốt, còn 00 §8 thắng cho hằng số.
- **Không tick test nào chưa chạy.** Lượt này chỉ sửa spec, chưa
  implement app, chưa deploy contract, chưa chạy test nào — mọi
  test C/V/L vẫn là "bắt buộc phải chạy", không phải "đã pass".
