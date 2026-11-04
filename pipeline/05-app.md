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
│   │   ├── validator.ts         # pre-flight 12 luật (04 §3)
│   │   ├── proposer.ts          # LLM + scripted proposer
│   │   ├── audit.ts             # hash-chained ledger
│   │   └── tools.ts             # tool catalog + x402 client
│   └── prisma/schema.prisma     # SQLite (xem §3)
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
| DB | SQLite qua Prisma | Không cần DB server cho demo; file DB không commit lên repo (chỉ schema) |
| LLM | Provider-agnostic, qua env `LLM_API_KEY` + `LLM_MODEL` | Không hardcode provider; không có key thì chạy scripted mode |
| x402 client | Middleware theo facilitator đã chọn (02 §2), v1 `exact` | Không tự viết lại EIP-712 từ đầu nếu middleware đã có |

## 3. DB schema — tối thiểu, đủ cho demo

```prisma
model AuditEntry {
  id         Int      @id @default(autoincrement())
  prevHash   String
  entryHash  String   @unique
  kind       String   // PROPOSED / EXECUTED / QUEUED / BLOCKED / ...
  actor      String   // agent address hoặc owner address hoặc "system"
  toAddress  String?
  amount     String?  // atomic units, lưu string để không tràn số JS
  rule       String?
  reason     String?
  txHash     String?
  createdAt  DateTime @default(now())
}

model ProposalRecord {
  id         Int      @id
  onchainId  Int      @unique
  status     String
  missionId  String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model ToolSession { // TalkMeter
  id         String   @id
  status     String   // ACTIVE / STOPPED / CAPPED
  minutes    Int      @default(0)
  totalPaid  String   @default("0")
  txHashes   String   @default("[]") // JSON array string
  createdAt  DateTime @default(now())
}
```

On-chain là source of truth cho proposal status; DB chỉ là bản
mirror để UI nhanh + audit. Nếu DB và on-chain lệch, tin on-chain.

## 4. API — contract giữa frontend và server, viết đúng như này

```
POST /api/propose
  body: { kind, to?, amount_atomic, mission_id?, reason, tool_id? }
  -> 200 { route: "EXECUTED"|"QUEUED", proposalId, txHash? }
  -> 403 { route: "BLOCKED", rule, reason }   // không có tx, đó là đúng
  -> 400 { error: "invalid_schema" }          // JSON sai schema

POST /api/queue/:id/approve   -> { txHashApprove, txHashExecute? } (xem 04 §6)
POST /api/queue/:id/reject    body: { reason } -> { txHash }
GET  /api/audit               -> list entries mới nhất trước
GET  /api/audit/verify        -> { valid: true } hoặc { valid: false, firstBadId }
GET  /api/policy              -> { perTxCap, dailyCap, spentToday, paused, agent, guard }
POST /api/tools/:id           -> 402 hoặc 200 + receipt (02 §3)
POST /api/tools/talkmeter/start|tick|stop  (02 §5)
```

**Auth cho demo:** owner action (approve/reject/pause/set policy) yêu
cầu ví connect đúng owner address, check ở cả frontend lẫn API
(không chỉ frontend — frontend check là UX, API check là bảo mật).
Agent propose không cần auth ví, nhưng bị giới hạn bởi validator.

## 5. UI — 4 màn hình, mỗi màn 1 nhiệm vụ, không làm dashboard "tất cả trong 1"

### Dashboard (`/`)

- Header: guard address (link Snowtrace) + paused badge (đỏ nếu paused)
  + mode badge (`LIVE LLM` / `SCRIPTED` / `MOCK` nếu đang mock).
- Policy card: per-tx cap, daily cap, spent today (progress bar),
  mission cap — số đọc từ contract, không hardcode text.
- Propose form: kind, to (dropdown allowlist, không cho gõ tự do
  trong demo chính — gõ tự do chỉ ở màn attack demo), amount, mission,
  reason → nút Propose → kết quả EXECUTED / QUEUED / BLOCKED + rule.
- Recent activity: 10 audit entry mới nhất, mỗi dòng có tx link nếu có.

### Queue (`/queue`)

- Bảng proposal Queued, mỗi dòng: to, amount, lý do queue, thời gian,
  nút Approve / Reject. Approve xong hiển thị 2 tx hash.
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
LLM_API_KEY=
LLM_MODEL=
AGENT_PRIVATE_KEY=        # testnet only, không bao giờ commit
OWNER_ADDRESS=
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
