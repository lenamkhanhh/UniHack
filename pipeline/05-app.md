# 05 — App, API, DB, UI (cho Gemini implement trực tiếp)

## 1. Monorepo layout — tạo đúng cấu trúc này, đừng tự đặt tên khác lung tung

```
UniHack/                         # repo nộp bài (sau này, xem §7)
├── pipeline/                    # spec này (đã có)
├── context/                     # research cũ (đã có)
├── apps/web/                    # Next.js app (dashboard + API)
│   ├── app/
│   │   ├── page.tsx             # Dashboard
│   │   ├── queue/page.tsx       # Human queue
│   │   ├── audit/page.tsx       # Audit ledger + verify
│   │   ├── demo/page.tsx        # Demo mode (6 scene, scripted)
│   │   └── api/
│   │       ├── propose/route.ts
│   │       ├── queue/[id]/approve/route.ts
│   │       ├── queue/[id]/reject/route.ts
│   │       ├── tools/[...]/route.ts
│   │       ├── audit/route.ts
│   │       └── audit/verify/route.ts
│   ├── lib/
│   │   ├── chain.ts             # Fuji config, viem clients, addresses
│   │   ├── validator.ts         # pre-flight BLOCK/QUEUE (04 §3)
│   │   ├── proposer.ts          # LLM + scripted proposer
│   │   ├── audit.ts             # hash-chained ledger (04 §7)
│   │   ├── missions.ts          # mission token verify + mission status re-check
│   │   └── tools.ts             # tool catalog + x402 client + operation lifecycle
│   ├── prisma/schema.prisma     # hosted Postgres, xem §3
│   └── scripts/verify-audit.ts  # verifier độc lập, đọc DB read-only (04 §7)
├── contracts/                   # Foundry
│   ├── src/GuardedTreasury.sol
│   ├── test/GuardedTreasury.t.sol
│   └── script/Deploy.s.sol
├── .env.example                 # placeholder only, không key thật
└── README.md                    # nộp bài: link, address, tx hash, cách chạy
```

**Nếu Gemini muốn gộp app + contracts vào 1 folder khác thì được,
nhưng tên file contract, tên hàm, tên API ở trên phải giữ nguyên**
— vì slides, video, test đều nhắc tới chúng.

## 2. Tech stack — chốt, không thay giữa chừng trừ khi có lý do ghi rõ

| Lớp | Chọn | Vì sao / ghi chú |
|---|---|---|
| Frontend | Next.js 14 App Router + Tailwind | Nhanh, deploy Vercel free, giám khảo mở link là chạy |
| On-chain read/write | viem + wagmi | Đọc Fuji không cần server riêng; owner ký bằng MetaMask |
| Wallet connect | wagmi injected (MetaMask) trong MVP | Privy là stretch (Team1 starter có, nhưng thêm dependency lúc deadline là rủi ro) |
| Contracts | Foundry + OpenZeppelin v5 | Test nhanh, verify Snowtrace dễ |
| DB (chốt) | **Hosted Postgres (Supabase free tier) qua Prisma provider `postgresql`** | Vercel Functions không có filesystem persistent cho SQLite (xem §3). Local dev dùng cùng Supabase dev DB, hoặc local Postgres — chỉ đổi `DATABASE_URL`, không đổi schema. **Cấm** `DATABASE_URL` trỏ tới file `.db` local ở production. |
| LLM | Provider-agnostic, qua env `LLM_API_KEY` + `LLM_MODEL` | Không hardcode provider; không có key thì chạy scripted mode |
| x402 client | Middleware theo facilitator đã chọn (02 §2), v1 `exact` | Không tự viết lại EIP-712 từ đầu nếu middleware đã có |

## 3. DB schema — tối thiểu, đủ cho demo

```prisma
// datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
// generator client { provider = "prisma-client-js" }

model AuditEntry {
  id            Int      @id @default(autoincrement())
  prevHash      String
  entryHash     String   @unique
  kind          String   // PROPOSED / EXECUTED / QUEUED / BLOCKED / ...
  actor         String   // agent address hoặc owner address hoặc "system"
  toAddress     String?
  amount        String?  // atomic units, lưu string để không tràn số JS
  rule          String?
  reason        String?
  txHash        String?
  missionId     String?  // slug mission, xem 04 §5
  operationId   String?  // operation x402, xem 02 §9
  policyVersion Int?
  resultHash    String?
  createdAt     DateTime @default(now())
}

model Mission {
  slug          String   @id // ví dụ "mission-demo-01"
  missionId     String   @unique // bytes32 hex của keccak256(slug)
  agentAddress  String
  ownerAddress  String
  treasuryCap   String
  toolCap       String
  spentTreasury String   @default("0")
  spentTool     String   @default("0")
  reservedTool  String   @default("0")
  expiresAt     DateTime
  status        String   // ACTIVE / CLOSED / EXPIRED
  activationNonce String? // nonce dùng một lần cho activation signature, xem §4b
  activationNonceExpiresAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// Global pause cho S1 (khi chưa có guard). S2 dùng guard.paused(), không dùng row này nữa — xem §4b.
model SystemState {
  id            Int      @id @default(1)
  systemPaused  Boolean  @default(false)
  pauseSource   String   @default("db") // "db" ở S1, "guard" ở S2
  updatedAt     DateTime @updatedAt
}

model ProposalRecord {
  id         Int      @id
  onchainId  Int      @unique
  status     String
  missionId  String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model ToolOperation { // x402 lifecycle, xem 02 §9
  // Khóa lookup chính là (missionSlug, operationId). Đồng thời có index global
  // trên operationId để phát hiện cross-mission reuse → 409 (xem 02 §9.7).
  missionSlug   String
  operationId   String
  payerAddress  String
  toolId        String
  inputHash     String
  paymentTerms  String   // JSON: price, asset, payTo, network, scheme, maxTimeoutSeconds
  paymentTermsHash String
  state         String   // CREATED / RESERVED / SIGNED / SETTLING / SETTLED / FAILED / UNKNOWN
  reservedAmount String  @default("0")
  txHash        String?
  sessionId     String?
  minuteIndex   Int?
  // Authorization — server-only, KHÔNG BAO GIỜ trả ra frontend/API công khai.
  authNonce     String?
  authFrom      String?
  authTo        String?
  authValue     String?
  validAfter    Int?
  validBefore   Int?
  authSignature String?  // v/r/s, để resubmit/recovery sau restart nếu cần
  // Held result — ghi trong cùng transaction với reservation, trước khi phát 402.
  heldResult    String?
  heldResultHash String?
  // Recovery — xem 02 §9.4.
  facilitatorName String?
  facilitatorTxHash String?
  lastReconciledAt DateTime?
  reconcileCount Int      @default(0)
  lastReconcileBlockTimestamp Int?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@id([missionSlug, operationId])
  @@index([operationId])
}

model ToolSession { // TalkMeter
  id         String   @id
  missionSlug String   // session bind mission, tick/stop phải dùng đúng token mission đó (02 §9.5)
  status     String   // ACTIVE / STOPPED / CAPPED
  minutes    Int      @default(0)
  totalPaid  String   @default("0")
  txHashes   String   @default("[]") // JSON array string
  createdAt  DateTime @default(now())
}
```

On-chain là source of truth cho proposal status; DB chỉ là bản
mirror để UI nhanh + audit. Nếu DB và on-chain lệch, tin on-chain.
Nếu DB hosted down, app vẫn đọc được dữ liệu on-chain và phần audit
hiển thị "audit DB unavailable" thay vì hiển thị rỗng giả tạo.

## 4. API — contract giữa frontend và server, viết đúng như này

```
POST /api/missions
  body: { slug, agentAddress, treasuryCap, toolCap, durationSeconds }
  + header X-Owner-Signature (EIP-191 personal_sign của message tạo mission, xem §4b)
  -> 201 { slug, missionId, expiresAt }   // mission tạo off-chain, chưa kích hoạt, chưa có token
  // S1: chữ ký tạo mission verify bằng OWNER_ADDRESS. Không có chữ ký owner thì không tạo được mission —
  // không để người lạ tự tạo mission rồi xin token.
  // S2: owner phải tạo mission on-chain bằng MetaMask TRƯỚC, rồi gọi API này kèm txHash on-chain;
  // server đọc mission từ chain rồi mới tạo record off-chain khớp chain (xem §4b).

POST /api/missions/:slug/nonce
  -> 200 { nonce, expiresAt }  // nonce dùng một lần, hết hạn 10 phút, lưu vào Mission (xem §4b)

POST /api/missions/:slug/activate
  body: { signature }  // EIP-191 personal_sign của message đúng format §4b, không tự thêm/bớt field
  -> 200 { missionToken }  // HMAC, scope = đúng 1 mission, expiry = mission expiry

POST /api/propose
  header: Authorization: Bearer <missionToken>
  body: { kind, to?, amount_atomic, mission_id (bắt buộc), reason, tool_id? }
  -> 200 { route: "EXECUTED"|"QUEUED", proposalId, txHash? }
  -> 403 { route: "BLOCKED", rule, reason }   // không có tx, đó là đúng
  -> 400 { error: "invalid_schema" }          // JSON sai schema
  -> 401 { error: "invalid_mission_token" }   // token sai, hết hạn, hoặc mission đã đóng/hết hạn

POST /api/queue/:id/record
  body: { action: "approve"|"reject"|"execute", txHash }
  -> 200 { ok: true }  // server verify tx on-chain (to == guard, proposalId, method) rồi mới ghi audit
  // Lưu ý: approve/reject/execute KHÔNG phải API submit tx. Owner ký bằng MetaMask ở frontend,
  // API này chỉ ghi audit sau khi verify tx. Backend không giữ owner key.
  // S1 không có queue on-chain, endpoint này chỉ dùng từ S2 trở đi.

GET  /api/audit               -> list entries mới nhất trước
GET  /api/audit/verify        -> { valid: true } hoặc { valid: false, firstBadId }
GET  /api/policy              -> { perTxCap, dailyCap, spentToday, paused, pauseSource, guard, policyVersion }
  // S1: perTxCap/dailyCap/guard là null, paused lấy từ SystemState, pauseSource = "db".
  // S2: số đọc từ guard, pauseSource = "guard". Frontend phải hiển thị đúng nguồn, không giả vờ S1 có guard.
GET  /api/missions/:slug      -> mission + spent/reserved/remaining/expiry cho từng budget riêng
POST /api/tools/:id           -> 402 hoặc 200 + receipt (02 §3, §9), cần missionToken nếu thuộc mission
GET  /api/tools/operations/:operationId
  header: Authorization: Bearer <missionToken của đúng mission của operation>
  -> 200 { state, txHash?, result? (chỉ khi SETTLED) }  // không token → 401 chung, token sai mission → 403, không lộ auth/held result
  // Lưu ý: operation lookup là (missionSlug từ token, operationId), không phải operationId đơn thuần.
POST /api/tools/talkmeter/start|tick|stop  (02 §5, §9.5, session bind mission)
POST /api/system/pause
  body: { paused: boolean, signature }  // S1 only, owner ký; S2 pause bằng guard.pause() on-chain, không qua API này
  -> 200 { paused, pauseSource }
```

### 4a. Auth — cơ chế nhỏ, đủ cho demo, không thêm hệ thống auth lớn

1. **Owner transaction do MetaMask ký (S2).** Approve/reject/pause/
   set policy/createMission/emergencyWithdraw đều là transaction từ
   ví owner qua wagmi/viem ở frontend. Backend không giữ owner key,
   không bao giờ submit owner tx.
2. **Agent transaction do backend ký, chỉ trong mission đã kích hoạt.**
   Backend giữ agent test key (server-side only, không bao giờ gửi
   ra frontend) để ký x402 và gọi `propose()`. Điều kiện để backend
   dùng key đó: request kèm mission token hợp lệ (xem §4b).
3. **Mission token (xem format đầy đủ ở §4b).** Server verify chữ
   ký, đối chiếu địa chỉ recovered với mission owner (S1: owner
   trong mission record; S2: thêm điều kiện owner đó phải bằng
   `guard.owner()` và mission on-chain phải khớp record). Đúng thì
   cấp token HMAC, scope = đúng slug đó, expiry = mission expiry.
   Token hết hạn, mission đóng/hết hạn, hoặc mission không tồn tại
   → mọi propose/tool call cho mission đó đều 401. Server vẫn
   check lại mission status ở mỗi call — token một mình không đủ.
   Token payload phải khớp mission record (slug, missionId, agent,
   cap); cap đổi thì token cũ vô hiệu, phải kích hoạt lại.
4. **Demo công khai:** khách không có token chỉ được đọc
   dashboard/audit/policy. Demo scripted chạy bằng mission demo do
   owner tạo trước, với input cố định trong script, không nhận
   recipient/amount tự do từ người lạ. Rate limit theo IP và ví tool
   chỉ nạp tiền test nhỏ là lớp phụ, không phải lớp chính.
5. **Không tin địa chỉ do client gửi:** agent address lấy từ key
   server, owner lấy từ mission record (S1) hoặc guard `owner()`
   (S2), payTo lấy từ tool config, mission agent lấy từ mission
   record. Field `from`/`owner` trong body (nếu có) bị bỏ qua hoàn toàn.

### 4b. S1 owner/auth/pause và chuyển sang S2 — định nghĩa đầy đủ, không để lửng

**S1 (chưa có guard):**

- **Owner:** địa chỉ owner ghi trong mission record lúc tạo mission,
  và phải trùng `OWNER_ADDRESS` cấu hình deploy (ví sẽ trở thành
  guard owner ở S2). Mọi check "owner" ở S1 đều đối chiếu với
  record này, không đọc contract. Tạo mission ở S1 yêu cầu chữ ký
  owner: message EIP-191 `mission-create:{slug}:{agentAddress}:{treasuryCap}:{toolCap}:{durationSeconds}:{domain}`,
  recovered phải bằng `OWNER_ADDRESS`, nếu không từ chối tạo.
- **Pause:** flag `systemPaused` trong bảng `SystemState`
  (một row duy nhất). Owner toggle bằng chữ ký EIP-191 trên message
  `system-pause:{paused}:{nonce}:{domain}` với nonce dùng một lần
  tương tự activation (server cấp nonce, hết hạn 10 phút).
  Pre-flight S1 (validator B3, tool pre-flight) check flag này.
  `GET /api/policy` ở S1 trả `paused` từ flag này và
  `pauseSource: "db"`.
- **Mission creation S1:** tạo record off-chain trực tiếp, chưa cần
  transaction. Activation vẫn theo §4b dưới đây, với owner check
  là mission record.

**S2 (đã có guard):**

- **Owner:** `guard.owner()` on-chain. Mission owner trong record
  phải bằng guard owner, nếu không mission đó không kích hoạt được.
- **Pause:** `guard.paused()` on-chain. `GET /api/policy` trả
  `pauseSource: "guard"` và không consult flag DB nữa.

**Cutover S1 → S2 (checklist bắt buộc, xem thêm 08 §3):**

1. Deploy guard với deployer = S1 owner (cùng một ví).
2. Với mỗi mission off-chain còn ACTIVE và chưa hết hạn: owner tạo
   mission on-chain bằng `createMission` với cùng slug → bytes32,
   cùng agent, cùng treasury cap, và expiry = expiry off-chain còn
   lại (nếu mission off-chain đã hết hạn thì không migrate — tạo
   mission mới thay vì migrate mission hết hạn).
3. Server đọc mission từ chain và cập nhật record off-chain khớp
   chain (agent, cap, expiry). Nếu chain và record lệch, tin chain
   và ghi rõ lệch ở đâu trước khi kích hoạt tiếp.
4. Đặt guard pause = trạng thái S1 pause lúc cutover (nếu S1 đang
   paused thì deploy guard ở trạng thái paused, hoặc pause ngay
   sau deploy trước khi nhận request mới).
5. Chuyển config `PAUSE_SOURCE` từ `db` sang `guard`. Từ thời điểm
   này, mọi check pause đều dùng guard, flag DB chỉ còn là lịch sử.
6. Mission token cũ (S1) phải kích hoạt lại sau cutover, vì payload
   và owner check giờ gắn với guard — token S1 không tự động có
   hiệu lực ở S2.

**Activation signature — format chốt, không tự thêm/bớt field:**

Message EIP-191 `personal_sign`, đúng các dòng sau, đúng thứ tự:

```
Guarded Agent Economy — mission activation
mission: <slug>
agent: <checksummed agent address>
treasuryCap: <atomic units, dạng string số nguyên>
toolCap: <atomic units, dạng string số nguyên>
nonce: <hex, do server cấp, dùng một lần>
expiresAt: <unix seconds, phải bằng mission expiresAt>
chain: fuji-43113
domain: <app origin đã cấu hình, ví dụ https://<app deploy> hoặc localhost:3000 ở dev>
```

- **Domain binding:** domain trong message phải bằng app origin đã
  cấu hình trên server (`APP_DOMAIN` env). Chữ ký cho domain khác
  bị từ chối — chống reuse chữ ký sang app giả mạo cùng slug.
  Nếu app đổi domain deploy thì phải kích hoạt lại mission.
- **Nonce lifecycle:** server cấp nonce qua
  `POST /api/missions/:slug/nonce`, lưu vào Mission với expiry 10
  phút. Nonce chỉ dùng được một lần: sau khi activate thành công
  (hoặc sau khi hết hạn) nonce đó vô hiệu, lần activate tiếp theo
  phải xin nonce mới. Nonce của mission này không dùng được cho
  mission khác, và nonce đã dùng không cấp lại token thứ hai.
- **Expiry binding:** `expiresAt` trong message phải bằng mission
  expiresAt, và token expiry cũng bằng mission expiresAt. Token
  không dài hơn mission. Mission hết hạn → token tự hết hiệu lực
  dù token chưa bị thu hồi tường minh.
- **Mission binding:** token payload gồm slug, missionId bytes32,
  agent, treasuryCap, toolCap. Server so payload với mission record
  ở mỗi call; lệch bất kỳ field nào → 401, phải kích hoạt lại.
  Đóng mission → token vô hiệu ngay, dù chưa hết expiry (server
  check status ở mỗi call).

## 5. UI — 4 màn hình, mỗi màn 1 nhiệm vụ, không làm dashboard "tất cả trong 1"

### Dashboard (`/`)

- Header: guard address (link Snowtrace, S2) hoặc "S1 — chưa có guard"
  (S1, ghi rõ) + paused badge (đỏ nếu paused, kèm nguồn pause: DB hay guard)
  + mode badge (`LIVE LLM` / `SCRIPTED` / `MOCK` nếu đang mock).
- Policy card: per-tx cap, daily cap, spent today (progress bar),
  policy version — số đọc từ contract, không hardcode text.
- Mission card: mission đang chọn, spent/reserved/remaining/expiry
  cho treasury và tool riêng, trạng thái ACTIVE/CLOSED/EXPIRED.
- Propose form: chỉ enable khi mission đã kích hoạt (có mission
  token); kind, to (dropdown allowlist, không cho gõ tự do trong
  demo chính — gõ tự do chỉ ở màn attack demo), amount, mission,
  reason → nút Propose → kết quả EXECUTED / QUEUED / BLOCKED + rule.
- Recent activity: 10 audit entry mới nhất, mỗi dòng có tx link nếu có.

### Queue (`/queue`)

- Bảng proposal Queued, mỗi dòng: to, amount, mission, lý do queue,
  policy version lúc propose, thời gian, nút Approve / Reject.
  Nút này ký bằng MetaMask của owner, không phải backend ký hộ.
  Approve xong hiển thị 2 tx hash (approve + execute riêng).
- Không có nút "approve all". Duyệt từng cái là ý nghĩa của human
  queue.

### Audit (`/audit`)

- Bảng full audit, filter theo kind/rule, nút Verify chain → hiển thị
  `valid: true` hoặc entry sai đầu tiên.
- Mỗi dòng có tx link Snowtrace nếu có; dòng BLOCKED ghi rõ
  "no tx — blocked before signing" (đó là feature, không phải thiếu).

### Demo (`/demo`)

- Chạy 6 scene theo kịch bản 07, từng scene có nút Run + kết quả +
  tx hash + thời gian. Dùng cho quay video và cho giám khảo tự bấm.
- Có nút "Reset demo data" chỉ reset UI/DB demo, **không** reset
  on-chain (on-chain không reset được — nói rõ).

## 6. Env — `.env.example` chỉ có placeholder, `.env` gitignored

```
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65
NEXT_PUBLIC_GUARD_ADDRESS=
NEXT_PUBLIC_IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
NEXT_PUBLIC_REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713
NEXT_PUBLIC_FACILITATOR_URL=https://facilitator.ultravioletadao.xyz
DATABASE_URL=             # hosted Postgres (Supabase), KHÔNG phải file .db local ở production
LLM_API_KEY=
LLM_MODEL=
AGENT_PRIVATE_KEY=        # testnet only, server-side only, không bao giờ commit, không bao giờ gửi ra frontend
MISSION_TOKEN_SECRET=     # HMAC secret cho mission token, server-side only
APP_DOMAIN=               # app origin dùng trong activation signature, ví dụ https://<app deploy>
OWNER_ADDRESS=            # S1 owner, phải bằng guard owner ở S2
PAUSE_SOURCE=db           # "db" ở S1, "guard" ở S2 — xem §4b, không tự đổi giữa chừng mà không làm cutover checklist
```

**Check trước khi push:** `grep -r "0x" --include="*.ts" --include="*.sol" .`
không được ra private key; `git status` không được thấy `.env`.

## 7. Repo nộp bài — cấu trúc cuối cùng khi Gemini xong

Repo nộp bài (public, hoặc private + collaborator `tuantqse90`) phải có:

- `README.md`: 1 câu sản phẩm, link app deploy, guard address +
  Snowtrace, agentId, facilitator đã dùng, cách chạy local (3 lệnh),
  bảng tx hash demo, giới hạn trung thực (00 §10).
- `contracts/` + test pass (lệnh chạy test ghi trong README).
- `apps/web/` chạy được bằng `npm install && npm run dev`.
- Không có `.env`, không có key, không có video nặng trong repo
  (video để link YouTube/Drive, slides để link Canva/Slides).

## 8. Lệnh chạy — ghi đúng vào README nộp bài

```bash
# Contracts
cd contracts && forge test

# App
cd apps/web && npm install && npm run dev
# Mở http://localhost:3000
```
