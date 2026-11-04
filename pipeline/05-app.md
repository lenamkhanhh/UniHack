# 05 — App, storage, authorization và API

**Owner của spec persistence/auth/API.** Payment lifecycle ở [02](02-x402-tools.md), contract ở [01](01-contracts.md).
Đây là thiết kế triển khai, chưa có app/schema migration được chạy trong repo.

## 1. Stack, layout và runtime

Next.js App Router + TypeScript + Tailwind; viem/wagmi/MetaMask; Prisma + hosted PostgreSQL (Supabase).
Pin phiên bản Next.js được hỗ trợ và bản vá bảo mật lúc tạo app, ghi lockfile; không ép Next.js 14 cũ chỉ vì spec trước chọn.
Vercel chạy web/API; không file SQLite local production, không timer RAM làm billing, không worker RAM làm source of truth.
S1 và S2 dùng cùng schema Postgres. Provision/migrate là công việc implementation, chưa thực hiện.
Secrets chỉ ở server; frontend không giữ AGENT_PRIVATE_KEY hay token signing secret.
Nếu ORM migration cần direct connection khác pooled runtime connection, ghi hai URL trong env template theo provider đã chọn.

Layout dự kiến:
```text
apps/web/app/{page.tsx,queue/page.tsx,audit/page.tsx,demo/page.tsx,api/...}
apps/web/lib/{chain,auth,validator,proposer,payments,reconcile,audit,tools}.ts
apps/web/prisma/{schema.prisma,migrations/...}
apps/web/tests/                       # P/V/E integration
contracts/{src/GuardedTreasury.sol,test/GuardedTreasury.t.sol,script/Deploy.s.sol}
scripts/verify-proof.ts               # đọc export, không cần DB secret
evidence/                            # manifest/receipt export đã chọn, không chứa credential
```

## 2. Persistence contract

Đoạn Prisma dưới đây là schema mục tiêu để Gemini hoàn thiện migration, không phải schema đã validate bằng Prisma.
Các số tiền là Decimal(78,0) để chứa uint256, không dùng JS Number.
API trả decimal integer strings; code dùng BigInt; kiểm tra `0 <= n <= 2^256-1`.
Mỗi transaction dưới đây phải có idempotent state transition, không chỉ read-modify-write ngoài transaction.

```prisma
model SystemState {
  id             Int      @id
  deploymentId   String
  stage          String   // S1 or S2
  guardAddress   String?
  authVersion    Int      @default(1)
  systemPaused   Boolean  @default(false)
  maintenance    Boolean  @default(false)
  updatedAt      DateTime @updatedAt
}

model Mission {
  slug           String   @id
  missionId      String   @unique
  ownerAddress   String
  agentAddress   String
  treasuryCap    Decimal  @db.Decimal(78, 0)
  toolCap        Decimal  @db.Decimal(78, 0)
  spentTool      Decimal  @default(0) @db.Decimal(78, 0)
  reservedTool   Decimal  @default(0) @db.Decimal(78, 0)
  expiresAt      DateTime
  status         String   // ACTIVE/CLOSED; expiry checked from expiresAt on every spend
  completedAt    DateTime?
  deliverableHash String?
  configVersion  Int      @default(1)
  policyHash     String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  operations     ToolOperation[]
  sessions       ToolSession[]
}

model AuthChallenge {
  nonce          String   @id
  action         String   // CREATE_MISSION/ACTIVATE/READ_MISSION/PAUSE_S1/CLOSE_MISSION_S1/COMPLETE_MISSION/PREPARE_FEEDBACK
  payloadHash    String
  expectedSigner String
  deploymentId   String
  authVersion    Int
  expiresAt      DateTime
  usedAt         DateTime?
  createdAt      DateTime @default(now())
}

model ToolSession {
  id             String   @id @db.Uuid
  missionSlug    String
  mission        Mission  @relation(fields: [missionSlug], references: [slug], onDelete: Restrict)
  payerAddress   String
  rate           Decimal  @db.Decimal(78, 0)
  cap            Decimal  @db.Decimal(78, 0)
  spent          Decimal  @default(0) @db.Decimal(78, 0)
  reserved       Decimal  @default(0) @db.Decimal(78, 0)
  status         String   // ACTIVE/STOPPED/CAPPED
  startedAt      DateTime @default(now())
  stoppedAt      DateTime?
  operations     ToolOperation[]
}

model ToolOperation {
  operationId    String   @id @db.Uuid
  deploymentId   String
  missionSlug    String
  mission        Mission  @relation(fields: [missionSlug], references: [slug], onDelete: Restrict)
  payerAddress   String
  toolId         String
  inputHash      String
  paymentTerms   String   // canonical immutable JSON
  paymentTermsHash String
  policyHash     String
  chainId        Int
  asset          String
  state          String
  version        Int      @default(0)
  authDeploymentVersion Int
  quoteExpiresAt DateTime
  reservationExpiresAt DateTime?
  reservedAmount Decimal  @default(0) @db.Decimal(78, 0)
  authFrom       String?
  authTo         String?
  authValue      Decimal? @db.Decimal(78, 0)
  authNonce      String?
  validAfter     BigInt?
  validBefore    BigInt?
  authSignature  String?  // server-only, immutable after SIGNED
  heldResult     String?
  heldResultHash String?
  workerLeaseUntil DateTime?
  submissionStartedAt DateTime?
  facilitator    String?
  facilitatorTxHash String?
  txHash         String?
  receiptBlockNumber BigInt?
  receiptBlockHash String?
  authorizationLogIndex Int?
  transferLogIndex Int?
  lastReconciledAt DateTime?
  reconcileBlockNumber BigInt?
  reconcileBlockHash String?
  reconcileBlockTimestamp BigInt?
  failureReason  String?
  sessionId      String?  @db.Uuid
  session        ToolSession? @relation(fields: [sessionId], references: [id], onDelete: Restrict)
  minuteIndex    Int?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([sessionId, minuteIndex])
  @@unique([chainId, asset, authFrom, authNonce])
  @@index([missionSlug, state])
}

model TreasuryRequest {
  operationId    String   @id @db.Uuid
  missionSlug    String
  requestHash    String
  state          String   // CREATED/SUBMITTING/UNKNOWN/CONFIRMED/FAILED
  agentNonce     BigInt?
  rawTxHash      String?
  proposalId     String?
  chainId        Int
  guardAddress   String
  createdAt      DateTime @default(now())
}

model AuditHead {
  id             Int      @id
  lastHash       String
}

model AuditEntry {
  id             BigInt   @id @default(autoincrement())
  sourceKey      String   @unique
  prevHash       String
  entryHash      String   @unique
  canonicalJson  String
  createdAt      DateTime
}

model MissionFeedback {
  missionSlug    String   @id
  agentId        String
  chainId        Int
  registry       String
  clientAddress  String
  txHash         String?
  feedbackIndex  String?
  feedbackURI    String?
  feedbackHash   String?
  preparedValue  Int?
  preparedResultHash String?
  state          String   // PREPARED/SUBMITTED/CONFIRMED
}
```

Migrations cần CHECK ngoài Prisma:
- SystemState/AuditHead chỉ có id=1; stage thuộc S1/S2.
- Số tiền uint256 range, spent/reserved/session amounts không âm; tool spent + reserved <= toolCap;
  session spent + reserved <= session cap. Owner không được hạ tool cap dưới exposure đã tồn tại.
- sessionId/minuteIndex cùng NULL hoặc cùng non-NULL; minuteIndex >= 0; session.mission/payer phải khớp operation
  (enforce bằng validation dưới row locks, có test; FK riêng không tự enforce quan hệ này).
- State hợp lệ; SIGNED trở đi cần authorization fields; SETTLED cần receipt binding + heldResult;
  FAILED cần failureReason. Mọi actor/token address normalize về lowercase khi lưu/so sánh.
- Global operationId là primary key, không chỉ index thường. Cross-mission reuse race do DB xử lý.
- PostgreSQL UNIQUE cho phép nhiều NULL mặc định: các operation chưa ký/không phải TalkMeter không xung đột giả.
- Không commit DB, secrets, signatures hay private heldResult vào repo.
  Public evidence chỉ lấy allowlist fields; không serialize nguyên ORM rows.

Atomic writes:
- Reserve/sign/expire/reconcile: lock mission → session nếu có → operation → audit head.
- Terminal state CAS + counters + audit cùng transaction. Duplicate worker/GET không double charge/release.
- Không giữ DB lock trong upstream/RPC/facilitator network calls. Dùng durable submission intent/lease.
- AuditHead lock serialize append; sourceKey unique tránh ghi trùng event/recovery.
- On-chain event ingestion dùng sourceKey `chain:txHash:logIndex`, check receipt success/finality,
  sender/method/guard/proposal, không tin txHash client tự báo. Missed events được backfill bằng chain scan.
- Mission treasury spent đọc từ chain; DB mirror không có quyền quyết định payout. Không reset ledger demo.
- TreasuryRequest lưu submission intent trước broadcast; cùng UUID encode bytes32 operationId vào propose (01).
  Retry tra mapping của guard hoặc cùng tx hash; không tạo proposal/EOA nonce mới khi chưa rõ.
  Serialize nonce của agent EOA khi gửi treasury transactions; pending tx phải reconcile trước khi thay thế.

## 3. Authorization: spend và read là hai quyền khác nhau

Wallet map:
- O: mission/guard owner, ký MetaMask; backend không giữ key O.
- A: agent tool signer + treasury proposer + registry NFT owner; backend giữ test key A.
- S: seller, khác A; không bán rồi trả về cùng ví để giả lập payment.
O khác A và không là approved operator của NFT A để feedback hợp lệ.

Server-generated EIP-191 challenge dùng cho mọi owner action, không chỉ activation.
Message UTF-8 chính xác:
```text
Guarded Agent Economy
action: <ACTION>
deployment: <DEPLOYMENT_ID>
domain: <APP_ORIGIN>
chainId: 43113
stage: <S1|S2>
guard: <lowercase-address-or-none>
authVersion: <integer>
payloadHash: <keccak256 canonical action payload>
nonce: <32-byte CSPRNG hex>
issuedAt: <unix seconds>
challengeExpiresAt: <issuedAt+600>
```

Payload phải hiển thị human-readable trên UI trước ký, server tự reconstruct và hash (04).
CREATE_MISSION bind slug, agent, hai cap, duration; COMPLETE_MISSION/PREPARE_FEEDBACK bind mission, deliverableHash, agentId và score khi có; ACTIVATE bind missionId, owner, agent, hai cap,
mission expiry, configVersion, policyHash; PAUSE_S1 bind desired bool; READ_MISSION bind slug + read action.
Server lưu challenge, action, payloadHash, expected signer và deployment/authVersion.
Consume nonce một lần trong cùng transaction với action/token issuance; hết hạn/reuse/wrong domain/action/payload → reject.
Không lấy recovered owner từ body; S1 đối chiếu OWNER_ADDRESS, S2 đối chiếu guard.owner() và mission record.
Không có chữ ký tạo mission tồn tại vô thời hạn. Challenge endpoint rate-limited; không được overwrite challenge khác.

Tokens dùng HMAC đã pin algorithm (HS256), verify signature constant-time qua thư viện chuẩn.
Payload: `type(spend|read), iss, aud, deploymentId, stage, chainId, guardAddress,
authVersion, missionSlug, missionId, owner, agent, missionConfigVersion, policyHash, iat, exp, jti`.
Không log token; browser không lưu lâu trong localStorage; cùng-origin POST kiểm tra Origin nếu dùng cookie.
- Spend: expiry <= mission expiry, TTL tối đa 24h; mỗi call re-check current owner/mission/agent/configVersion,
  pause/maintenance, stage/guard/authVersion. Mission CLOSED/expired chặn reserve/sign mới.
- Read: owner ký READ_MISSION để nhận credential 15 phút, không bị giới hạn bởi mission expiry/status.
  Chỉ đọc state/result/proof và yêu cầu reconciliation, không reserve/sign/payout, không đổi mission.
  Spend token hợp lệ cũng đọc được; token spend hết hạn thì dùng owner challenge xin read token mới.
- Đóng mission, pause, revoke spend và cutover không được xóa operation/reserved/heldResult.
  Owner vẫn có đường read/reconcile sau các sự kiện này.
- Nếu owner address đổi, dừng spend cho tới khi cấu hình rõ. Không âm thầm chuyển read access cho người không được xác minh.
  MVP không demo owner transfer; không đưa chức năng recovery key mới vào scope.

S1: OWNER_ADDRESS là authority, SystemState.systemPaused là pause; không gọi guard.
S2: owner/mission treasury/pause là chain authority; read failure chặn spend mới, không xóa state.

Cutover S1 → S2:
1. Bật maintenance để dừng reserve/sign mới; đọc/reconcile vẫn chạy. Chờ worker sign đang claim hoàn tất;
   reconcile outstanding operations hoặc giữ nguyên exposure và metadata cũ.
2. Deploy guard với O; tạo mission on-chain tương ứng còn hạn, đọc lại agent/cap/expiry từ receipt/storage.
   createMission nhận duration nên expiry thực tế tính từ block; đồng bộ DB với chain, không giả định trùng từng giây.
3. Copy pause có chủ ý, ghi deployment manifest và cutover audit.
4. Trong transaction cập nhật stage, guardAddress, authVersion += 1 và mission configVersion khi thay.
   Tokens/challenges S1 cũ bị reject thực sự bởi version/stage/guard binding.
5. Kích hoạt credential S2 mới, tắt maintenance. Old operations giữ payment scope lúc tạo;
   owner read credential hiện tại được đọc/reconcile historical operations thuộc cùng deployment/mission.
   Cutover không tạo mới operation, reset ngân sách hoặc xóa history.

## 4. API contract

| Endpoint | Quyền / hành vi |
|---|---|
| POST /api/auth/challenge | Tạo challenge cho action/payload đã validate; không thực thi action |
| POST /api/missions | Owner signed CREATE_MISSION; S2 phải verify createMission on-chain trước DB mirror |
| POST /api/missions/:slug/activate | Consume ACTIVATE challenge → spend token |
| POST /api/missions/:slug/read-access | Consume READ_MISSION challenge → read token dù mission đã đóng/hết hạn |
| POST /api/missions/:slug/close | S1 owner signature; S2 MetaMask closeMission + verified chain record |
| POST /api/missions/:slug/complete | Owner signed COMPLETE_MISSION, persist deliverableHash/completedAt, được phép sau expiry |
| POST /api/missions/:slug/feedback | Owner signed PREPARE_FEEDBACK → chuẩn bị metadata + tx MetaMask, record event idempotent theo 03 |
| POST /api/system/pause | S1 owner signed PAUSE_S1; S2 dùng MetaMask guard.pause/unpause |
| POST /api/propose | Spend token, operationId, strict proposal; S1 reject treasury kind |
| POST /api/tools/:id | Spend token + operationId; quote/paid request theo 02 |
| POST /api/tools/operations/:id/reserve | Internal orchestrator boundary, spend token; không endpoint ký tùy ý |
| GET /api/tools/operations/:id | Read/spend credential đúng mission; reconcile lazy, result chỉ SETTLED |
| POST /api/tools/talkmeter/start,tick,stop | Spend để tạo/tick; stop không hủy outstanding payment; read lấy receipts |
| POST /api/queue/:id/record | Verify receipt/event, chỉ mirror tx owner đã ký, không submit owner tx |
| GET /api/policy | Public snapshot, S1 guard/perTx/daily = null; S2 chain values |
| GET /api/missions/:slug | Credential để xem private mission/results; public demo chỉ curated snapshot |
| GET /api/audit, /api/audit/verify | Public sanitized demo entries/checkpoint; private results chỉ owner |
| GET /api/missions/:slug/proof | Owner read/spend credential → private export; public bundle opt-in sanitized |

Unauthorized operation lookup trả cùng lỗi chung (404 cho valid credential sai scope/ID; 401 cho thiếu credential),
không tiết lộ existence/state/tx/result bằng khác biệt message. UUID không phải authorization.
401/403/409 details cho request đã được xác thực dùng theo 02, không trả ORM error stack.
Tool route không có "nếu thuộc mission": mọi payment do server agent signer thực hiện đều phải có mission.
Rate-limit auth challenge, quote, upstream và public demo; cap input/provider timeout, không trust LLM URLs.

## 5. UI và env

Bốn màn: Dashboard (mission + hai budget + kết quả), Queue (S2 owner MetaMask),
Audit (filter/export/checkpoint), Demo (scripted cùng đường kiểm tra, không nút wipe DB).
Nút read recovery sau mission expiry; trạng thái UNKNOWN hiện pending amount, reason và last checked block.
Treasury remaining hiển thị max(0, cap-spent) và overBy riêng nếu owner override; không giấu overspend.
Tool remaining = cap-spent-reserved. Không tạo treasury reserved từ queue vì queue cần owner override.
New operation không được che outstanding operation cũ.

Env template khi implement:
```dotenv
APP_ORIGIN=
DEPLOYMENT_ID=
DATABASE_URL=
DIRECT_URL=
OWNER_ADDRESS=
AGENT_PRIVATE_KEY=
MISSION_TOKEN_SECRET=
LLM_API_KEY=
LLM_MODEL=
FACILITATOR_URL=https://facilitator.ultravioletadao.xyz
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_GUARD_ADDRESS=
```
Addresses/ABIs/versions/finality lấy từ manifest (00), không duplicate secrets vào NEXT_PUBLIC.
Stage/authVersion/guard phải đồng nhất với SystemState; startup mismatch → fail closed.
Secrets template chỉ rỗng/placeholders; .env/.env.local/DB dump/raw signatures gitignored.

Các lệnh dự kiến sau khi app tồn tại: install bằng lockfile, Prisma migrate dev/deploy theo môi trường,
test integration với DB test riêng, rồi npm run dev/build. Gemini phải ghi lệnh thực tế đã chạy vào README;
không copy các lệnh này như bằng chứng đã chạy. Chưa có app nên lượt sửa spec không chạy Prisma/Next/forge.
