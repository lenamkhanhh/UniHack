# 10 — Review-response: 12 góp ý của GPT, đối chiếu với spec tại commit 8dd1f49

**HEAD đã kiểm tra trước khi sửa:** local và remote đều là
`8dd1f492ce91011139af61606844b0e1c31da4b4`, working tree sạch,
không có thay đổi mới nào để ghi đè. Mọi sửa ở lượt này đều dựa
trên commit đó.

**Cách đọc verdict:**

- `ACCEPT` — GPT đúng, spec cũ sai/thiếu, đã sửa trong lượt này.
- `PARTIAL` — GPT đúng một phần, hoặc đúng vấn đề nhưng đề xuất
  cần thu hẹp cho scope hackathon.
- `REJECT` — GPT sai, hoặc đề xuất làm vỡ MVP; có lý do cụ thể.
- `ALREADY FIXED` — spec cũ đã xử lý đúng, chỉ cần ghi rõ hơn
  (không tính là sửa lớn).

Mỗi mục ghi đường dẫn spec cũ (tại 8dd1f49) và đường dẫn spec mới
sau lượt sửa, để Gemini không phải đoán "đã sửa ở đâu".

---

## 1. Mission envelope chưa được enforce đầy đủ — ACCEPT

**Spec cũ sai ở đâu:**

- `pipeline/01-contracts.md` §3–§4: `missionId` là `bytes32` tự do,
  `0x0` = không thuộc mission nào, chỉ check cap "nếu có missionId".
  Không có struct mission, không có existence/expiry/agent assignment,
  không có hàm tạo/đóng mission.
- `pipeline/04-agent.md` §2, §5: LLM cung cấp `mission_id` trong JSON,
  validator chỉ cộng `missionSpent`. LLM đổi ID là né cap, bỏ mission
  là né luôn mission cap.

**Quyết định sau sửa (xem 01 §3–§5, 04 §5, 00 §8):**

- Treasury payout trong S2 **bắt buộc thuộc một mission đã tồn tại**,
  `missionId != 0` là điều kiện hard. Không có payout treasury
  "ngoài mission" trong S2.
- Mission do owner tạo, không do LLM tạo: on-chain
  `createMission(missionId, cap, duration, agent)` và
  `closeMission(missionId)`; off-chain record lưu slug, treasury cap,
  tool cap, agent, expiry, trạng thái.
- `propose()` check hard: mission tồn tại, chưa hết hạn, chưa đóng,
  `msg.sender == mission.agent`.
- **Hai budget riêng, không gộp:** mission treasury cap (10 USDC,
  enforce on-chain) và mission tool cap (5 USDC, enforce off-chain
  bởi validator + reservation, xem 02 §9). Không ghép x402 vào
  guard contract — đó là quyết định giữ nguyên, vì ghép sẽ làm vỡ
  MVP và không cần thiết cho bài toán.
- UI/pitch phải hiển thị hai budget riêng: spent/reserved/remaining/
  expiry cho từng budget, không cộng thành một con số "mission spent"
  mơ hồ.

**Phần GPT đề xuất nhưng không làm:** ghép shared budget vào contract
cho cả tool payment. Từ chối phần này vì lý do trên, không phải vì
không hiểu đề xuất.

## 2. Schema và queue mâu thuẫn — ACCEPT

**Spec cũ sai ở đâu:**

- `pipeline/04-agent.md` §2: schema yêu cầu `amount_atomic ≤ per-call/
  per-tx cap`, trong khi §3 lại nói treasury vượt cap thì QUEUE.
  Một amount vừa "sai schema" vừa "được queue" là mâu thuẫn không
  implement được.
- `pipeline/02-x402-tools.md` §6 mục 6: tool payment vượt tier thì
  "chuyển sang queue", trong khi `04` §3 nói tool không queue trong
  MVP. Hai file nói hai hành vi khác nhau.

**Quyết định sau sửa (xem 04 §2–§3, 02 §6):**

- Schema chỉ check hình dạng: JSON parse được, kind hợp lệ, address
  hợp lệ, amount là số nguyên dương, reason ≤ 200 chars, không field
  lạ. Schema **không** check cap.
- Policy quyết định BLOCK/QUEUE/EXECUTE. Tất cả BLOCK check trước,
  rồi mới tới QUEUE check (per-tx → daily → mission treasury).
- Proposal được queue **phải** gọi `propose()` on-chain để có bản
  ghi on-chain; DB `ProposalRecord` chỉ là mirror, không bao giờ là
  proposal. API không được tạo proposal "chỉ trong DB".
- **Một hành vi duy nhất cho tool:** tool payment không có human
  queue trong MVP. Vượt per-call cap, tool cap, session cap, hoặc
  seller không allowlisted → BLOCK, không queue. Nếu một tool purchase
  cần người duyệt, cách đúng là duyệt một treasury payout để nạp
  tiền vào ví tool của agent trước, rồi tool payment mới chạy —
  không phải queue chính tool payment đó.

## 3. Human approval và state machine chưa chốt — ACCEPT

**Spec cũ thiếu ở đâu:**

- `pipeline/01-contracts.md` §5–§6: `execute()` nói "chỉ chạy proposal
  đã Approved hoặc Queued mà owner vừa approve" (mơ hồ); không nói
  approve/execute sau expiry, Approved có hết hạn không, recipient
  bị gỡ allowlist sau khi queue, mission hết hạn sau approve, execute
  lặp, owner duyệt vượt cap thì cap nào bị override, policy đổi giữa
  propose và execute.

**Quyết định sau sửa (xem 01 §5–§6, 06 §1):**

- Phân biệt hard vs soft, ghi thành luật:
  - **Hard, không bao giờ override:** paused, recipient không còn
    allowlisted tại thời điểm execute, mission hết hạn/đóng tại
    thời điểm execute, proposal đã Executed/Rejected/Expired.
    Vi phạm hard → `execute()` revert, status không đổi, owner phải
    reject hoặc đợi expire.
  - **Soft, owner được duyệt ngoại lệ cho đúng proposal đó:** per-tx
    cap, daily cap, mission treasury cap. Đây là giới hạn của
    auto-execution, không phải giới hạn tuyệt đối.
- Expiry check **trong** `approve()` và `execute()`, không dựa vào
  việc có ai gọi `expire()` hay không. `expiresAt` tính từ lúc propose
  (48h), không reset khi approve. `approve()`/`execute()` sau expiry
  đều revert. `expire()` chỉ là hàm dọn dẹp trạng thái, ai cũng gọi
  được, cho proposal Queued hoặc Approved quá hạn.
- Execute lặp: `execute()` chỉ chạy khi status == Approved, lần hai
  revert vì status đã là Executed. Approve lặp: chỉ chạy khi status
  == Queued.
- Accounting sau override: `spentToday` và `missionSpent` tăng đủ
  amount đã duyệt, kể cả khi vượt cap. Override không tạo ra tiền
  ngoài sổ — sổ vẫn ghi đúng số đã chi, chỉ là cap auto đã bị vượt
  bởi quyết định có chủ ý của owner.
- Policy đổi giữa propose và execute: hard check dùng policy **hiện
  tại** tại lúc execute; cap gây queue không được đánh giá lại —
  proposal đã queue không tự chạy khi cap được nới, và vẫn chạy
  đúng amount đã duyệt khi cap bị siết (vì owner approval là quyết
  định có chủ ý). Proposal lưu `policyVersion` lúc propose để proof
  bundle đối chiếu được.

## 4. Public API có thể thành đường tiêu hộ ví agent — ACCEPT (với cơ chế nhỏ)

**Spec cũ sai ở đâu:**

- `pipeline/05-app.md` §4: "Agent propose không cần auth ví, nhưng
  bị giới hạn bởi validator" trong khi server giữ `AGENT_PRIVATE_KEY`.
  Người ngoài gọi request hợp lệ là tiêu được ngân sách mission,
  dù không được giao mission.
- Cũng ở §4: owner action "check ở cả frontend lẫn API" nhưng không
  nói ai ký owner transaction — backend ký hộ owner hay MetaMask ký
  là hai thiết kế khác nhau hoàn toàn.

**Quyết định sau sửa (xem 05 §4, 04 §5):**

- **Owner transaction do MetaMask ký, không do backend ký.**
  Approve/reject/pause/set policy/createMission/emergencyWithdraw
  đều là transaction từ ví owner qua wagmi/viem. Backend không giữ
  owner key, không bao giờ submit owner tx. API chỉ ghi audit sau
  khi verify tx on-chain.
- **Agent transaction do backend ký, nhưng chỉ trong mission đã
  kích hoạt:** owner kích hoạt mission bằng một chữ ký EIP-191
  (`personal_sign`) trên mission slug + agent address + nonce +
  expiry; server verify chữ ký, đối chiếu owner với `owner()` của
  guard, rồi cấp mission token (HMAC, scope = đúng một mission,
  expiry = mission expiry). Mọi `POST /api/propose` và
  `POST /api/tools/*` cho mission đó phải kèm token đó. Server
  vẫn check lại mission status (tồn tại, chưa hết hạn, chưa đóng)
  ở mỗi call — token một mình không đủ.
- **Demo công khai không nhận input tùy ý:** khách không có token
  chỉ được đọc dashboard/audit/policy. Demo scripted chạy bằng
  mission demo do owner tạo trước, với input cố định trong script,
  không nhận recipient/amount tự do từ người lạ. Quota demo (rate
  limit theo IP, ví tool chỉ nạp tiền test nhỏ) là lớp phụ, không
  phải lớp chính.
- Không thêm hệ thống auth lớn (không OAuth, không user DB, không
  role phức tạp). Cơ chế trên là: 1 chữ ký owner + 1 token HMAC
  scoped + re-check mission ở mỗi call.
- Server không bao giờ tin field `from`/`owner` trong request body:
  agent address lấy từ key server, owner lấy từ guard `owner()`,
  payTo lấy từ tool config.

## 5. x402 cần lifecycle, idempotency và reservation — ACCEPT (mô hình đơn giản hơn đề xuất)

**Spec cũ thiếu ở đâu:**

- `pipeline/02-x402-tools.md` §3: chỉ có 402 → sign → 200, không có
  trạng thái operation, không có reservation, không xử lý retry,
  concurrent request, timeout sau settlement, hoặc response bị mất.
  Random nonce chống replay cùng authorization, đúng, nhưng không
  giải quyết được các tình huống trên.

**Quyết định sau sửa (xem 02 §9, 06 §3):**

- Operation có `operationId` (UUID do client gửi, header
  `X-Operation-Id`; nếu client không gửi, server tạo và trả về,
  nhưng client phải gửi lại nó ở retry thì mới được idempotency).
  Trạng thái: `CREATED → RESERVED → SIGNED → SETTLING → SETTLED /
  FAILED / UNKNOWN`. Đây là mô hình đơn giản hơn đề xuất gốc nhưng
  đủ cho MVP, vì mỗi trạng thái gắn với một hành động cụ thể, không
  phải trạng thái trang trí.
- **Thứ tự đúng cho "no money for nothing":** server chạy upstream
  **nội bộ** (chưa trả kết quả), giữ kết quả (TTL ngắn), rồi mới trả
  402. Client trả tiền, server settle confirmed, rồi mới trả kết quả
  đã giữ. Upstream lỗi trước settlement → không charge, operation
  FAILED. Đây là điểm sửa quan trọng so với spec cũ nói "verify
  trước, serve sau" nhưng không nói kết quả giữ ở đâu.
- Budget khả dụng = `toolCap − spent − reserved`. Reservation tạo
  khi RESERVED, hết hạn khi authorization hết hạn (60s) hoặc khi
  operation FAILED, chuyển thành spent khi SETTLED.
- Retry: cùng operationId + cùng input hash → trả lại kết quả/tx
  cũ, không ký payment mới. Cùng operationId + input hash khác →
  409. Settlement UNKNOWN (facilitator timeout, response mất) →
  **không** ký payment mới; chạy recovery: check
  `authorizationState(authorizer, nonce)` trên USDC, nếu nonce đã
  dùng thì không charge lại và trả kết quả đã giữ (ghi rõ tx hash có
  thể chưa tra được, không bịa tx hash).
- TalkMeter: unique `(sessionId, minuteIndex)`, minuteIndex tính
  bằng **server time** từ `startedAt` (floor((now − startedAt)/60)),
  không tính bằng tick client gửi. Tick trùng → trả receipt cũ.
  Tick cho phút tương lai → reject. Tick đồng thời cùng phút → DB
  unique constraint quyết định một người thắng.
- Giới hạn nói rõ: không hứa "tiền đi mà không nhận được response
  là không bao giờ xảy ra" nếu chưa có recovery. Spec mới nói đúng:
  recovery ngăn charge hai lần, nhưng tx hash trong trường hợp
  UNKNOWN có thể phải tra lại từ facilitator, không tự có.

## 6. Pause không thu hồi authorization x402 đã ký — ACCEPT (mô tả đúng giới hạn)

**Spec cũ nói quá ở đâu:**

- `pipeline/01-contracts.md` §5 và `02` §5: pause "chặn propose +
  execute + tool pre-flight", nghe như kill switch chặn mọi thứ,
  trong khi authorization EIP-3009 đã ký vẫn settle được trước
  `validBefore`.

**Quyết định sau sửa (xem 00 §10, 02 §9, 07 §1 scene 6):**

- Pause chặn: propose mới, execute mới, reservation mới, pre-flight
  mới. Pause **không** thu hồi authorization đã ký và còn trong
  60s TTL. Đó là giới hạn của EIP-3009, không phải bug của guard.
- Rủi ro tồn đọng được giới hạn bằng số, không bằng lời: tối đa
  một authorization / phút / tool, TTL 60s, per-call cap, và
  reservation đã trừ vào tool cap. Settlement nào rơi vào sau thời
  điểm pause phải được ghi audit là `SETTLED_AFTER_PAUSE`, không
  được giấu.
- Không triển khai cancellation phức tạp trong MVP. Nếu muốn chặn
  hẳn, cách đúng là rút ngắn TTL hoặc dừng facilitator — cả hai đều
  ngoài scope và phải nói rõ nếu làm.

## 7. ERC-8004 cần sửa ABI và chủ thể feedback — ACCEPT (GPT đúng về ABI)

**Đối chiếu chuẩn (đã đọc trực tiếp, không dựa vào trí nhớ):**

- Nguồn: https://eips.ethereum.org/EIPS/eip-8004 — trạng thái
  **DRAFT** (không phải final). Reputation Registry, Read Functions:
  `getSummary(uint256 agentId, address[] calldata clientAddresses,
  string tag1, string tag2)` trả về `(uint64 count, int128
  summaryValue, uint8 summaryValueDecimals)` — **4 tham số, không
  phải 3** như spec cũ ghi.
- Cũng tại đó: `readFeedback(uint256 agentId, address clientAddress,
  uint64 feedbackIndex)` và `readAllFeedback(uint256 agentId,
  address[] calldata clientAddresses, string tag1, string tag2,
  bool includeRevoked)`. **Không có `getFeedback(agentId)`** như
  spec cũ ghi ở `03` §3.3.
- `giveFeedback` thì spec cũ ghi đúng signature và đúng quy tắc
  "submitter không được là owner/operator của agent đó".
- Off-chain feedback file có field `proofOfPayment` (from/to/chainId/
  txHash) làm ví dụ — nhưng EIP không nói registry tự chứng minh
  payment; và phần Security Considerations cảnh báo Sybil là có
  thể, mitigation là filter theo reviewer.

**Quyết định sau sửa (xem 03 §3–§4):**

- Sửa ABI: `getSummary` 4 tham số, `readFeedback` /
  `readAllFeedback` thay cho `getFeedback`. Ghi rõ: **ABI của
  contract đã deploy trên Fuji mới là chuẩn cuối cùng** — Gemini
  phải pin ABI file + địa chỉ registry thực tế dùng, và nếu ABI
  deploy khác bản EIP draft thì deploy thắng, không được tự suy
  từ EIP.
- Chủ thể feedback, chốt lại (spec cũ nhập nhằng giữa agent và tool
  seller):
  - **Mission Agent** (agentId demo duy nhất trong MVP, owned by
    team) là chủ thể được feedback.
  - **Feedback client** là mission owner / demo client wallet,
    **không** phải agent owner, **không** phải agent wallet.
  - Tool seller trong MVP **không bắt buộc** có ERC-8004 identity;
    trust của seller là allowlist + giá cố định, không phải reputation.
- Payment chứng minh quan hệ nào: app enforce, không phải registry
  enforce. Feedback API chỉ chấp nhận feedback nếu nó tham chiếu
  tới một operation SETTLED thuộc đúng mission đó (tra từ operation
  record + audit), và caller là mission owner. Registry chỉ lưu
  điểm, không chứng minh đã trả tiền.
- Tag: bỏ `successRate` khỏi MVP feedback, vì chỉ feedback sau call
  thành công thì không thể gọi đó là success rate của mọi call.
  MVP chỉ dùng `starred` (quality 0–100 từ mission owner). Tỷ lệ
  hoàn thành mission tính từ operation record (attempted vs settled)
  là metric off-chain, ghi rõ là off-chain, không phải ERC-8004.

## 8. SQLite local không khớp Vercel Functions — ACCEPT

**Đối chiếu:**

- Nguồn user đưa (Vercel KB "Is SQLite supported in Vercel") và
  nguyên lý serverless: filesystem của function là ephemeral, chỉ
  `/tmp` ghi được và không chia sẻ giữa các instance, dữ liệu mất
  khi instance recycle hoặc deploy lại. Spec cũ (`05` §2) vừa nói
  deploy Vercel vừa nói SQLite local là mâu thuẫn không chạy được
  cho audit/session.

**Quyết định sau sửa (xem 05 §2–§3):**

- **Chốt một phương án, không để hai phương án lửng:** Next.js
  deploy Vercel + **hosted Postgres (Supabase free tier) qua Prisma
  provider `postgresql`**. Schema models giữ nguyên tên/field, chỉ
  đổi datasource. Local dev dùng cùng một Supabase dev database
  (không cần Docker Postgres), hoặc local Postgres nếu team muốn —
  chỉ đổi `DATABASE_URL`, không đổi schema.
- **Cấm:** `DATABASE_URL` trỏ tới file `.db` local ở production,
  và mọi code path dựa vào file SQLite trên Vercel. Nếu DB hosted
  down, app vẫn đọc được dữ liệu on-chain (guard, x402 tx, ERC-8004)
  và phần audit hiển thị "audit DB unavailable" thay vì hiển thị
  rỗng giả tạo.

## 9. Hash chain chưa đủ để claim không cần tin team — ACCEPT

**Spec cũ nói quá ở đâu:**

- `pipeline/04-agent.md` §7: "ledger này mà sửa 1 dòng là lộ ngay"
  và `09` §1: "không cần tin team" — trong khi cùng team kiểm soát
  cả DB lẫn verifier API thì viết lại toàn bộ lịch sử và tính lại
  chain là được. `verify=true` chỉ chứng minh dữ liệu hiện tại nhất
  quán với nhau, không chứng minh lịch sử chưa từng bị viết lại.

**Quyết định sau sửa (xem 04 §7, 09 §1, 05 §3):**

- Định nghĩa canonical encoding cụ thể (JSON key sort, value string,
  null → `""`, timestamp ISO đã lưu) để verifier độc lập tính lại
  được đúng hash — spec cũ chỉ ghi công thức cộng chuỗi mơ hồ.
- Proof bundle nối: mission → operation → policy version → payment
  tx → result hash. Result hash là hash của kết quả tool đã trả
  (không phải kết quả tự nhận), để người kiểm tra đối chiếu được
  kết quả với payment.
- Verifier độc lập: script trong repo (không phải chỉ API endpoint
  của cùng server) đọc DB read-only và tính lại chain. Checkpoint:
  hash của entry cuối được ghi vào proof bundle / README nộp bài
  (neo ngoài DB) — nếu DB bị viết lại thì checkpoint cũ sẽ lệch.
  Đây là mức neo rẻ nhất cho hackathon, không phải anchor on-chain.
- Đổi câu claim: hash chain chứng minh **integrity + consistency**,
  không chứng minh **chất lượng câu trả lời** của agent, và không
  thay thế việc kiểm tra tx trên Snowtrace.

## 10. Claim an toàn và attack test — ACCEPT

**Spec cũ nói quá ở đâu:**

- `pipeline/04-agent.md` §8: "bị lừa cũng không mất tiền" và
  `00` §2 / `06` §2: "guard thì 0 mất" không kèm phạm vi threat model.
  Agent vẫn mua được tool hợp lệ nhưng vô ích trong cap; agent key
  bị lộ vẫn propose được trong policy.

**Quyết định sau sửa (xem 00 §10, 04 §8, 06 §2, §5):**

- Câu claim đúng, dùng nguyên văn trong pitch/slides/video:
  "Bị lừa cũng không chuyển tới recipient trái phép, không vượt
  cap tự động, và không approve vô hạn — nhưng vẫn có thể mua tool
  hợp lệ nhưng vô ích trong cap, và agent key bị lộ vẫn propose
  được trong policy."
- Mô hình tổn thất tối đa, ghi thành bảng:
  - Tới attacker ngoài allowlist qua treasury auto: **0**, vì
    recipient check là hard.
  - Lãng phí qua allowlisted recipient / tool hợp lệ nhưng vô ích:
    tối đa `dailyCap` treasury + `toolCap` mission trong kỳ, nếu
    agent key bị lộ và attacker propose liên tục trong policy.
  - Quỹ trong guard không bị rút trực tiếp bởi agent key: đúng, vì
    không có hàm rút cho agent.
- Attack đối chứng: cùng intent/payload (cùng recipient, amount,
  mission, tool, input) cho cả naive và guarded, ghi before/after
  cả hai bên, và **thêm positive control**: một request hợp lệ phải
  thành công sau khi attack bị chặn, để chứng minh hệ thống không
  "chặn tất cả". "0 mất" chỉ là kết quả của các kịch bản đã chạy,
  không phải chứng minh tổng quát.

## 11. Build plan và test plan chưa nhất quán — ACCEPT

**Spec cũ mâu thuẫn ở đâu:**

- `pipeline/08-build-plan.md` §1: S1 Rails 7–9/11, S2 Guard 10–12/11,
  nhưng §3 lại yêu cầu contract + T1–T12 **trước** tool server.
  Làm theo §3 là phá stage và phá fallback.
- `pipeline/06-tests-security.md` §1: gọi tất cả là `forge test`
  trong khi T6 (unlimited approval) là validator test, T12 (audit
  khớp event) là integration test — không chạy bằng forge được.
- `context/spike-checklist.md`: numbering T1–T12 lệch với pipeline
  mới, scope vẫn nói "Blocked event" (event bị revert xóa, xem mục 3
  và 01 §7), và chưa có mission/operation gate.

**Quyết định sau sửa (xem 08 §1, §3, §4; 06 §1–§3; context/spike-checklist.md):**

- Đồng bộ thứ tự: S0 spike → **S1 tool server + TalkMeter + identity
  display + S1 submission pack** → S2 contract + validator + queue +
  audit → S3 feedback + proof bundle + demo → stretch. §3 đã viết
  lại theo đúng thứ tự này.
- Tách test thành 3 loại, ghi rõ lệnh chạy ở đâu:
  - **Contract (forge):** C-series — guard logic, mission, state machine.
  - **Validator/API integration (vitest/node):** V-series — schema,
    policy, operation idempotency, TalkMeter unique tick, audit hash.
  - **Live smoke (Fuji):** L-series — 402→pay→200 thật, guard tx thật,
    ERC-8004 thật. Bảng mapping T cũ → C/V/L mới giữ trong 06 để
    không mất dấu.
- Mission cap/expiry, duplicate execute, reservation và retry: nếu
  thuộc claim MVP thì test tương ứng là **bắt buộc**, không phải
  "nếu còn thời gian". Đã đưa vào C/V bắt buộc.
- S1 fallback có submission checklist riêng (07 §4): nếu chỉ nộp S1
  thì README/slides/video không được claim guard hay ERC-8004
  feedback chưa xây.

## 12. Định vị và phần tạo khác biệt — PARTIAL (chấp nhận trục use case, không chấp nhận thêm feature mặc định)

**Phản biện đề xuất của GPT:**

- Đề xuất trục use case — "Nhóm nghiên cứu/CLB giao agent một nhiệm
  vụ có ngân sách; agent mua công cụ để hoàn thành; mọi khoản chi
  đối chiếu được với quyền được cấp và kết quả nhận lại" — là
  **đúng và làm sản phẩm rõ hơn**. Spec cũ nói "quỹ nhóm/CLB" chung
  chung nhưng không có trục mission xuyên suốt; mission lúc đó chỉ
  là một field cap, không phải đơn vị công việc. Sau sửa, mission
  là đơn vị trung tâm: một mission có người giao, agent được giao,
  hai budget, expiry, và receipt nối mission → policy → payment →
  result.
- Đề xuất này **không làm vỡ fallback S1** nếu hiểu đúng: S1 vẫn là
  tool marketplace + TalkMeter, nhưng kể cả S1 cũng phải có mission
  record off-chain (người giao, tool cap, expiry) để receipt có ý
  nghĩa — mission off-chain ở S1 rẻ, không cần guard contract.
  S2 mới thêm mission on-chain + treasury cap. Nếu bắt S1 phải có
  guard thì mới vỡ fallback; spec mới không bắt vậy.
- Đề xuất này **không làm đội hai người quá tải** nếu ba ưu tiên
  được chia đúng core/stretch như sau — và đây là điểm spec cũ
  làm ngược (để proof bundle và mission timeline ở stretch):
  - **Core (S3, không phải stretch):** (1) Mission budget display
    (spent/reserved/remaining/expiry, treasury và tool riêng) và
    (2) Receipt/proof bundle (mission → policy version → payment
    tx → result hash, kèm verifier script độc lập). Hai thứ này
    không phải feature mới, chúng là **lớp bằng chứng** của chính
    use case đã chốt. Không có chúng thì mission chỉ là cap, không
    phải câu chuyện đối chiếu được.
  - **Stretch (S4, chỉ khi S1–S3 xong):** (3) Replay cùng yêu cầu
    dưới các policy khác nhau — nhưng implement dưới dạng
    **policy simulation off-chain** (cùng proposal JSON + snapshot
    mission, chạy validator với 3 policy variant, không submit tx),
    không phải replay on-chain (sẽ double-spend). Replay on-chain
    là đề xuất cần bác bỏ phần implementation, giữ lại ý tưởng.
- **Hướng tốt hơn / trade-off cần nói thẳng:** các thành phần riêng
  đều đã có tiền lệ (GateKeep cho x402 + ERC-8004 trên Fuji,
  AgentVault cho guard pattern, Wallie cho pre-payment rails). Điểm
  khác biệt **không** nằm ở việc phát minh thêm một component mới,
  mà nằm ở sự kết hợp có thể kiểm chứng: mission-scoped budget +
  receipt nối đủ mắt xích + replay giải thích được vì sao một
  request auto/queue/block. Claim "novel component" là sai và sẽ bị
  hỏi vặn; claim "mission-scoped, auditable, explainable" là đúng
  và kiểm chứng được. Vì vậy 09 đã viết lại: core là bằng chứng,
  stretch mới là tính năng thêm, và list "KHÔNG làm" giữ nguyên.

---

## Vấn đề bổ sung (không nằm trong 12 góp ý, nhưng ảnh hưởng thật)

**B1. `toolAllowlist` trong guard là thừa và gây nhầm — đã sửa.**
Guard không kiểm soát x402 settlement, nên allowlist tool on-chain
không có tác dụng gì trong MVP. Spec mới **bỏ `toolAllowlist`
khỏi guard**; tool allowlist chỉ tồn tại off-chain (tool config +
validator). Treasury payout tới ví seller (nếu có) chỉ cần
recipient allowlist.

**B2. UTC-day cap có kẽ hở qua nửa đêm — đã ghi vào giới hạn.**
Agent có thể chi đủ dailyCap lúc 23:59 UTC và lại đủ cap lúc 00:01
UTC. Đây là giới hạn đã biết của ngày UTC, không phải bug ẩn.
Pitch phải nói đúng, rolling cap là stretch sửa nó (09 §5), không
được quảng cáo UTC-day như rolling.

**B3. Emergency withdraw cũ nhận địa chỉ tùy ý — đã sửa.**
`emergencyWithdraw(to)` cho phép owner rút về bất kỳ địa chỉ nào
là footgun không cần thiết. Spec mới: `emergencyWithdraw()` chỉ
rút về chính owner, và chỉ khi paused.

**B4. AgentURI chết thì identity mất ý nghĩa — đã sửa.**
Spec mới yêu cầu agent registration file để trong repo
(`agent.json` đi kèm repo nộp bài) làm agentURI, thay vì trỏ tới
app deploy có thể down lúc chấm.

**B5. Facilitator version phải ghi ở spike, không giả định v1 — đã sửa.**
Nếu facilitator chọn chỉ hỗ trợ v2 thì client/server phải đổi cùng
lúc (02 §1 đã nói), và spike gate mới yêu cầu ghi rõ version +
scheme thực tế đã dùng, không chỉ ghi tên facilitator.

**B6. Owner transfer và deployer = agent — đã chốt.**
Deployer là owner, agent là ví khác, không dùng chung. Owner
transfer không nằm trong MVP (không test, không demo).

---

# Addendum — Lượt review nhỏ trước khi giao Gemini (base commit 56939ab)

**HEAD đã kiểm tra trước khi sửa:** local và remote đều là
`56939abd45030d9538c5dce3309402284ba4c883`, working tree sạch,
không có thay đổi mới nào để ghi đè. Lượt này giữ nguyên hướng
sản phẩm và scope, chưa implement app, chưa deploy contract.

## A1. Nonce chưa dùng sau timeout không chứng minh payment thất bại — ACCEPT

**Spec cũ sai ở đâu:**

- `pipeline/02-x402-tools.md` §9.4 (tại 56939ab): "Nonce chưa dùng
  → operation chuyển sang FAILED, reservation được trả lại, client
  có thể bắt đầu operation mới." Điều này sai vì authorization vẫn
  có thể settle sau đó, trong cửa sổ `validBefore`.
- Cũng tại §9.4: "nonce đã dùng → authorization đã settle, trả kết
  quả đã giữ" — sai vì nonce EIP-3009 chuyển `false → true` qua
  cả transfer, receive, **và cancel**. Bằng chứng: EIP-3009 định
  nghĩa `authorizationState(authorizer, nonce)`, `transferWithAuthorization`
  và `cancelAuthorization(authorizer, nonce, …)`; nonce bị đánh dấu
  đã dùng khi bị cancel mà không có transfer nào xảy ra. Ngoài ra
  cửa sổ hợp lệ là `block.timestamp > validAfter` **và**
  `block.timestamp < validBefore` (strict), nên wall-clock vượt 60s
  không tự nó kết luận được gì — phải đối chiếu block timestamp
  trên chain.

**Quyết định sau sửa (xem 02 §9.2, §9.4):**

- Phân biệt SETTLING (facilitator đã ack, có tx hash, đang chờ
  receipt) và UNKNOWN (không có ack, không biết đã submit hay chưa).
- UNKNOWN giữ nguyên trạng thái và giữ reservation cho tới khi một
  trong hai điều kiện xảy ra: (a) receipt settlement xác nhận được
  (tx receipt có Transfer từ payer tới payTo đúng amount, và/hoặc
  event AuthorizationUsed cho (authorizer, nonce) nếu contract
  deploy emit nó) → SETTLED; (b) block timestamp mới nhất trên chain
  đã **vượt** `validBefore` **và** tại thời điểm đó nonce vẫn chưa
  dùng → FAILED, lúc đó mới giải phóng reservation.
- Nonce đã dùng nhưng không tra được receipt/event nào → giữ
  UNKNOWN, không trả kết quả, không giải phóng reservation, không
  bịa tx hash. Trường hợp này cần đối chiếu thủ công (facilitator
  dashboard / Snowtrace); nếu event AuthorizationCanceled cho
  (authorizer, nonce) được tìm thấy thì mới chuyển FAILED.
- Không giải phóng reservation chỉ vì wall-clock vượt 60s. Reservation
  hết hạn khi và chỉ khi đã reconcile xong trên chain theo quy tắc
  trên.

## A2. S1 không có guard nhưng auth/pause vẫn gọi guard — ACCEPT

**Spec cũ mâu thuẫn ở đâu:**

- `pipeline/04-agent.md` §3 B3: kill switch check `guard.paused()`.
- `pipeline/05-app.md` §4a: verify mission token bằng cách đối chiếu
  owner với `owner()` của guard.
- Cả hai đều vô nghĩa ở S1, khi guard chưa deploy. Spec cũ chỉ nói
  "S1 mission chỉ tồn tại off-chain" (04 §5) mà không định nghĩa
  owner/auth/pause của S1, cũng không nói cách chuyển sang S2.

**Quyết định sau sửa (xem 05 §4a–§4b, 04 §3 B3, 01 §5, 08 §3):**

- **S1 owner:** địa chỉ owner ghi trong mission record off-chain
  lúc tạo mission, và phải trùng `OWNER_ADDRESS` cấu hình deploy
  (ví sẽ trở thành guard owner ở S2). Không đọc từ contract vì
  chưa có contract.
- **S1 pause:** flag `systemPaused` lưu trong DB (một row duy nhất,
  owner toggle bằng chữ ký, không phải bằng transaction). Pre-flight
  S1 check flag này, không check guard.
- **S2 pause:** `guard.paused()` on-chain. Tại cutover S1→S2: deploy
  guard với owner = S1 owner, tạo mission on-chain khớp mission
  off-chain (cùng slug → bytes32, agent, cap, expiry chưa qua),
  đặt guard pause = trạng thái S1 pause lúc đó, rồi chuyển config
  `PAUSE_SOURCE` từ `db` sang `guard`. Từ đó flag DB không còn
  được consult nữa.
- **Activation signature, chốt đầy đủ (05 §4b):** message EIP-191
  personal_sign có đúng các field sau, theo đúng thứ tự và format
  này, không tự thêm/bớt field khi implement:
  `Guarded Agent Economy — mission activation` +
  `mission: <slug>` + `agent: <checksummed>` +
  `treasuryCap: <atomic>` + `toolCap: <atomic>` +
  `nonce: <hex>` + `expiresAt: <unix>` + `chain: fuji-43113` +
  `domain: <app origin đã cấu hình>`.
  Nonce do server cấp qua `POST /api/missions/:slug/nonce`, dùng
  một lần, hết hạn 10 phút; nonce đã dùng hoặc hết hạn → từ chối.
  Token HMAC scope = đúng một mission, expiry = mission expiry,
  và server vẫn re-check mission status ở mỗi call. Token payload
  phải khớp mission record (slug, missionId, agent, cap); cap đổi
  thì token cũ vô hiệu, phải kích hoạt lại.

## A3. ToolOperation chưa lưu đủ dữ liệu recovery — ACCEPT

**Spec cũ thiếu ở đâu:**

- `pipeline/05-app.md` §3 (tại 56939ab): `ToolOperation` chỉ có
  operationId, toolId, inputHash, state, reservedAmount, txHash,
  missionId, sessionId, minuteIndex. Không có held result,
  authorization (nonce/payer/validity/signature), payment terms,
  facilitator record, hay reconcile state — nên server restart giữa
  SETTLING/UNKNOWN là mất khả năng recovery, và held result chỉ
  tồn tại "trong bộ nhớ, TTL ngắn" (02 §9.1) là không đủ.
- Reservation cũng chưa được định nghĩa là atomic: hai operation
  khác nhau gửi đồng thời có thể cùng pass check cap rồi cùng
  trừ, vượt cap.

**Quyết định sau sửa (xem 05 §3, 02 §9.1–§9.2):**

- Mở rộng `ToolOperation` với: `payerAddress`, `paymentTerms`
  (price, asset, payTo, network, scheme, maxTimeoutSeconds, dạng
  JSON), `authNonce`, `authFrom`, `authTo`, `authValue`,
  `validAfter`, `validBefore`, `authSignature` (server-only, không
  bao giờ trả ra frontend), `heldResult` + `heldResultHash`,
  `facilitatorName`, `facilitatorTxHash`, `lastReconciledAt`,
  `reconcileCount`, `lastReconcileBlockTimestamp`, và
  `operationKey` = hash của (mission, operationId) để lookup.
- Held result phải được ghi vào DB **trong cùng transaction** với
  reservation, trước khi 402 được phát hành. Nếu ghi held result
  thất bại thì không có RESERVED, không có 402. Held result sống
  cùng vòng đời operation, không phải TTL bộ nhớ ngắn.
- Reservation atomic: một DB transaction duy nhất — lock row
  mission (`SELECT … FOR UPDATE` trong transaction Postgres),
  đọc spent/reserved, check available, rồi mới tạo operation
  RESERVED và tăng `reservedTool`. Không có lock thì test
  concurrent ở A3 sẽ fail, và đó là fail đúng.
- Authorization và signature lưu server-only: GET operation không
  bao giờ trả chúng ra, chỉ trả state, txHash, và (khi SETTLED và
  có quyền) held result.

## A4. Threat model phải tách LLM compromise khỏi private-key compromise — ACCEPT

**Spec cũ sai ở đâu:**

- `pipeline/06-tests-security.md` §5 (tại 56939ab): row "Agent key
  bị lộ" ghi tổn thất tối đa là `dailyCap + toolCap trong kỳ`.
  Điều này đúng cho treasury (guard enforce on-chain) nhưng sai
  cho tool wallet: attacker giữ agent private key không cần đi qua
  API/validator, ký EIP-3009 trực tiếp tới bất kỳ payTo nào, với
  bất kỳ amount nào, và rút toàn bộ số dư ví tool. ToolCap,
  session cap, tool allowlist, velocity — tất cả đều là off-chain,
  chỉ enforce được với luồng đi qua server.
- Spec cũ cũng gộp LLM compromise và key compromise vào cùng một
  câu "agent key bị lộ vẫn propose được trong policy" (04 §8),
  làm mờ ranh giới quan trọng nhất: LLM bị lừa thì vẫn bị validator
  chặn, key bị lộ thì validator không còn đứng giữa nữa.

**Quyết định sau sửa (xem 06 §5, 04 §8, 00 §10):**

- **LLM compromise (không có key):** attacker chỉ điều khiển output
  LLM, vẫn phải đi qua validator + guard + server API. Tổn thất
  tối đa: treasury auto tới allowlisted recipient, trong
  dailyCap/mission treasury cap; tool tới allowlisted seller, trong
  toolCap/session cap/per-call cap. Đây là trường hợp mà validator
  còn có tác dụng.
- **Private-key compromise (có agent key):** attacker bypass toàn
  bộ off-chain enforcement cho tool payment. Tổn thất tối đa cho
  tool = **toàn bộ số dư ví tool tại thời điểm bị lộ, cộng mọi
  lần nạp thêm trước khi phát hiện/đóng mission**. Treasury vẫn
  được guard bảo vệ: không rút trực tiếp, auto-execution vẫn bị
  allowlist + per-tx + daily + mission cap on-chain chặn, trừ khi
  attacker đã nằm trong allowlist.
- **Giả định nạp tiền, nói rõ:** MVP không auto-refill ví tool.
  Refill chỉ bằng treasury payout do owner duyệt. Mỗi lần refill
  tăng exposure thêm đúng số refill đó. Nếu team thêm auto-refill
  thì mô hình tổn thất này vỡ — không làm auto-refill trong MVP.
- **Ngày UTC:** key holder có thể auto-execute tới dailyCap mỗi
  ngày UTC (kẽ hở qua nửa đêm vẫn còn), nhưng mission treasury cap
  là tổng cho cả mission, không reset theo ngày — nên tổng treasury
  auto cho một mission vẫn bị mission cap chặn, trừ khi owner tạo
  mission mới.
- **Sau khi phát hiện key lộ:** đóng mission ngay (revoke token,
  server ngừng dùng key đó), tạo mission mới với ví agent mới,
  không refill ví cũ. Số dư còn lại trong ví cũ không thu hồi được
  bằng guard hay pause — pause không chặn được attacker ký trực tiếp.

## A5. Ràng buộc operationId với mission, caller/payer, tool, input, payment terms — ACCEPT

**Spec cũ thiếu ở đâu:**

- `pipeline/02-x402-tools.md` §9.3 (tại 56939ab): retry chỉ check
  operationId + inputHash. Không ràng buộc mission, payer, payment
  terms — nên cùng operationId có thể bị dùng lại ở mission khác,
  hoặc retry với payer/amount/payTo khác vẫn được xử lý.
- `GET /api/tools/operations/:operationId` không yêu cầu quyền —
  ai đoán được operationId cũng tra được trạng thái, tx hash, và
  (khi SETTLED) kết quả.

**Quyết định sau sửa (xem 02 §9.3, §9.7; 05 §4):**

- Operation identity đầy đủ là bộ 6: (mission, operationId, payer,
  tool, inputHash, paymentTermsHash). Lookup chính là
  (missionSlug, operationId), và server đồng thời check index
  global: operationId đã tồn tại ở mission khác → `409`
  cross-mission reuse, không tạo operation mới.
- Paid retry phải khớp **tất cả**: mission từ token (không từ body),
  payer = `auth.from` = mission agent = operation payer, toolId từ
  path, inputHash tính lại từ input, payment terms (amount, payTo,
  asset, network, scheme) khớp operation đã lưu. Khác bất kỳ field
  nào: mission/payer khác → `403`; input/payment terms khác →
  `409`. Không settle payment không khớp scope, không tạo operation
  mới từ retry sai scope.
- TalkMeter session cũng bind mission: session tạo dưới mission
  token nào thì tick/stop phải dùng đúng token mission đó.
- Recovery/result endpoint kiểm tra quyền: `GET /api/tools/operations/:operationId`
  và việc trả held result đều yêu cầu mission token của đúng mission
  của operation đó. Không token → `401`; token của mission khác →
  `403`. Không token thì không được biết operation tồn tại hay không
  (trả 401 chung, không phân biệt "không tồn tại" với "không có quyền"
  trong response chi tiết — ít nhất không lộ held result hay tx hash).
