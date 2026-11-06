# UniHack — Review lần 5: ba blockers còn lại, evidence và prompt sửa

Ngày tổng hợp: 2026-11-05, Asia/Saigon.
Repository: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
Branch/HEAD: main @ d247015ee855f7ef48297ea9f49c606346efa690.
Input: REPORT_REVIEW_AND_FIX_COMPLETION.md bản Vòng 4.

Lượt này không sửa app/contracts/migration, không commit/push/deploy. Chỉ đọc source, chạy checks/probes và thêm file Markdown này.
Implementation vẫn uncommitted; HEAD không định danh đầy đủ working tree.

## 0. Kết luận

Có tiến bộ rõ và tests lần này đã gọi implementation thật:
- 28/28 tests pass.
- Independent TypeScript check exit 0.
- Production build exit 0.
- Active foreign submission lease không còn bị gọi settle tùy ý ở case đã test.
- Unauthorized proof GET không còn ghi backfill.
- Proof/audit có RepeatableRead và public bundles.
- Client có stable intent ID/pending polling và orchestrator có input conflict checks.
- SQL không còn suy missing receipt = MOCK.

**Tuy nhiên chưa nghiệm thu local S1 correctness. Ba blockers dưới đây được tái hiện bằng actual handler/SQL, không chỉ đọc code.**

| ID | Severity | Root issue | Evidence |
|---|---|---|---|
| M5-01 | HIGH | Existing-operation branch không resume CREATED/RESERVED qua reserve/sign | Actual orchestrator handler trả 500 |
| M5-02 | HIGH | Forward migration không normalize legacy mock receipt trước CHECK mới | Actual SQL replay trong PGlite fail 23514 |
| M5-03 | HIGH | Proof trộn persisted và regenerated projections, sai order/source integrity | Actual proof handler xuất new→old và rehash tampered legacy thành valid proof |

Không gọi các phần còn lại "chỉ thiếu live keys". PostgreSQL daemon, browser E2E, Foundry, L1/L2 và supported Next vẫn là các gates riêng.

## 1. Checks thực sự đã chạy

| Check | Reviewer result |
|---|---|
| Unit & production-boundary tests | 28/28 pass, 684ms test execution |
| Independent tsc | Exit 0 |
| Next production build | Exit 0; có ECONNREFUSED 127.0.0.1:55432 ở page generation |
| Retry actual orchestrator handler | CREATED/RESERVED/FAILED đều HTTP 500 |
| SQL initial schema + legacy SETTLED mock + forward migration | Initial fixture valid; forward migration fail SQLSTATE 23514 |
| Mixed legacy/new actual proof handler | HTTP 200, source order new→old, fresh verifier pass, persisted head không khớp export |
| Tampered legacy actual proof handler | Source entry hash mismatch, nhưng HTTP 200 và export verifier pass |
| Full PostgreSQL integration | Không chạy; không có daemon evidence mới |
| Browser E2E | Không chạy |
| Forge / live Fuji | Không chạy |
| Source modifications | Không; chỉ thêm tài liệu review |

Commands:
~~~powershell
git rev-parse HEAD
git status --short -- .
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/tests/unit-boundaries.test.ts
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next build apps/web
git diff --check -- .
~~~

Ngoài ra:
- Scoped rg/Get-Content và JSON source reads.
- Actual handler probes chạy qua node --require tsx/cjs -, alias TSX_TSCONFIG_PATH trỏ apps/web/tsconfig.json.
- SQL replay dùng installed @electric-sql/pglite trong ephemeral memory, không filesystem DB.
- Đọc local package README để xác nhận new PGlite() là in-memory.
- Không cài dependency, không sửa PostgreSQL/WSL/service, không dùng real keys/network payment.

PGlite ở đây chỉ xác minh SQL CHECK/migration behavior. Nó không thay real PostgreSQL server cho locking/concurrency/integration gates.

## 2. M5-01 — Existing operation không resume đúng từng state

Sources:
- apps/web/app/api/tools/orchestrate/route.ts:54–115.
- apps/web/lib/payments.ts:450–451.
- Flow mới ở orchestrator:118 trở đi.

Behavior:
- New request đi quote → reserve → sign → execute.
- Retry thấy existing operation thì bỏ qua reserve/sign và gọi execute trực tiếp cho mọi non-SETTLED state.
- execute đúng khi reject CREATED/RESERVED vì chưa có authorization.
- Lỗi nằm ở orchestrator không dispatch resume theo state.

Actual handler probe, valid test JWT, exact same operationId/tool/input:
~~~json
{"state":"CREATED","status":500,"error":"Cannot execute operation in state CREATED: must be SIGNED before execution"}
{"state":"RESERVED","status":500,"error":"Cannot execute operation in state RESERVED: must be SIGNED before execution"}
{"state":"FAILED","status":500,"error":"Cannot execute terminal FAILED operation"}
~~~

Đây là crash/retry gap thực tế:
1. Quote đã persist nhưng reserve chưa xong.
2. Hoặc reserve đã persist nhưng sign chưa xong.
3. Client retry cùng ID theo đúng idempotency contract.
4. API trả 500 và không resume.

Không chữa bằng cách cho execute chạy upstream khi CREATED/RESERVED. Guard đó phải giữ nguyên.

### Fix đề xuất

Dùng một resume operation state machine cho cả new và existing request, sau immutable identity/scope validation:

| Current state | Hành động |
|---|---|
| CREATED | Revalidate quote expiry, mission/policy/version; atomic reserve; sau đó sign nếu còn hợp lệ |
| RESERVED | Revalidate reservation/mission/config; sign đúng một authorization hoặc cleanup expiry |
| SIGNED | Acquire execution/submission ownership; reuse persisted auth; compute/settle theo invariant |
| SUBMITTING | Active foreign lease → pending; otherwise recovery trước takeover theo policy |
| SETTLING | Reconcile candidate receipt; không compute hoặc ký mới |
| UNKNOWN | Recovery/nonce/events/lease theo policy; same auth, no new purchase |
| SETTLED | Same persisted result/receipt/mode, không side effect |
| FAILED | Terminal DTO + stable domain error/status, không 500 runtime exception và không revive |

Yêu cầu:
- Phân biệt input/scope conflict, expired quote, paused mission và internal error.
- Không đổi operationId/nonce để tránh resume.
- Client cùng ID và exact input phải recover.
- Concurrent retry trong lúc request đầu đang CREATED/RESERVED không trả internal 500 vì thiếu state dispatch.
- Reserve/sign vẫn atomic/idempotent; owner pause/mission expiry giữa hai bước chặn chữ ký mới đúng cách.
- FAILED retry không đi vào executor; báo rõ terminal outcome theo API contract.
- New và existing branch dùng cùng service orchestration, tránh copy flow khác nhau.

Mapping: P4/P5/P10/P11/P12/P14/P21; V4/V9 và V4-06.

Tests phải gọi actual orchestrator/service:
- Retry CREATED valid → reserve/sign/execute đúng một lần.
- Retry RESERVED valid → sign/execute, không reserve lần hai.
- Expired CREATED/RESERVED → cleanup/appropriate response, không signer.
- Concurrent new + retry giữa mỗi durable step.
- FAILED retry → stable terminal response, zero key/upstream/facilitator calls.
- Same ID khác input → 409 vẫn giữ.
- Same settled ID → same result vẫn giữ.

## 3. M5-02 — Forward migration fail trên mock receipt cũ

Source:
apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql:18–44.

Hiện migration:
1. Gán MOCK cho old row có txHash prefix mock:.
2. Thêm CHECK mới yêu cầu MOCK có receiptBlockNumber/receiptBlockHash NULL.
3. Không clear hoặc archive synthetic receipt fields cũ trước ADD CONSTRAINT.

Implementation ban đầu từng ghi:
- txHash mock:<operationId>.
- receiptBlockNumber=1000.
- Fake non-null receiptBlockHash.
- Authorization/Transfer log indices.

Những row này hợp lệ với initial schema nhưng vi phạm CHECK mới.
Vì vậy migration không apply được ngay trên dữ liệu đã được chính app cũ sinh ra.

### Evidence SQL

Replay actual files:
- 20261104000000_init/migration.sql.
- Insert a legacy mission and SETTLED mock operation đúng initial constraints.
- Execute 20261104100000_round2_hardening/migration.sql.

Observed:
~~~text
LEGACY_FIXTURE_ACCEPTED_BY_INITIAL_SCHEMA
UPGRADE_FAIL:
SQLSTATE 23514
constraint ToolOperation_settled_requires_receipt_and_result
check constraint is violated by some row
~~~

SQL engine: installed PGlite, ephemeral in-memory.
Không claim DB_VERIFIED của deployment hay real PG concurrency.

### Fix đề xuất

1. Inspect/classify legacy mock provenance theo explicit marker; không dùng absence of receipt để suy mock.
2. Trước validate mode-aware CHECK:
   - Preserve old synthetic evidence provenance trong appropriate legacy metadata/archive nếu cần.
   - Normalize synthetic receipt block/hash/log/reconcile fields của known MOCK rows về representation mock hiện hành.
   - Không sửa real live evidence.
3. Pending/signed/UNKNOWN ambiguous rows không tự simulated settle hoặc xóa.
4. Không reset tables/DB để làm migration pass.
5. Apply trong transaction/deployment plan phù hợp, verify row counts/invariants.
6. Nếu migration file đã apply ở một môi trường, dùng forward migration mới; không sửa checksum/history tùy ý.
7. Nếu code chuyển sang mockReceiptId riêng, migrate schema/data cùng lúc và update DTO/export.
8. Không dùng NOT VALID để né việc bảo đảm existing data hợp lệ rồi gọi migration đã verified.

Tests:
- Fresh empty schema upgrade.
- Old MOCK SETTLED có synthetic block/log fields.
- Old LIVE SETTLED với real receipt fields.
- Old LIVE SIGNED/UNKNOWN chưa có receipt.
- Ambiguous historical row có explicit migration policy.
- Sau upgrade, mock không có fake chain receipt; real evidence giữ nguyên.
- Row counts/pending exposure không bị reset.

Mapping: V4-04, T04/T10, R13/R14, G2-28/G2-29.

## 4. M5-03 — Proof mixed history bị reorder; rehash che source corruption

Sources:
- apps/web/app/api/missions/[slug]/proof/route.ts:51–62,86–119.
- apps/web/lib/audit.ts:301–365.

GET giờ read-only và authorization đúng hướng; giữ các sửa đó.
Vấn đề mới nằm ở việc blend hai representation:
- Persisted mission projection nếu có.
- Freshly regenerated chain từ global canonicalJson nếu không có.

### Case A: legacy + new projected event

Fixture hợp lệ với upgrade path hiện tại:
- Old entry id=1, companion fields NULL.
- New entry id=2, missionSequence=1, persisted mission chain bắt đầu zero vì historical head chưa backfill.
- Query order missionSequence ASC rồi id ASC.

PostgreSQL ASC để NULL sau non-NULL trong ordering này.
New projected event được đọc trước old legacy event.
Handler giữ persisted new hash rồi rehash old event ở đuôi.

Actual handler:
~~~json
{
  "status":200,
  "sourceKeyOrder":["new","old"],
  "exportValid":true,
  "persistedHeadMatchesExport":false
}
~~~

Verifier pass chỉ chứng minh generated chain tự consistent; không chứng minh chronology/source order/checkpoint continuity.
Một export mới có thể dùng root khác persisted mission root dù chưa có namespace/version distinction.

### Case B: tampered legacy source

Fixture:
- Original stored entryHash được tính từ original canonicalJson.
- canonicalJson bị sửa reason nhưng entryHash giữ nguyên.
- Không có persisted companion hash.
- GET parse canonicalJson và tính hash mới, không kiểm original entryHash.

Observed:
~~~json
{
  "sourceHashMismatch":true,
  "status":200,
  "exportValid":true
}
~~~

Claim bị giới hạn:
- Đây là source-integrity check bị bỏ qua ở legacy projection path.
- Không khẳng định hash chain có thể chứng minh operator chưa rewrite toàn bộ history trước trusted checkpoint.
- Nhưng known mismatch giữa persisted source bytes/hash không được silently "sửa" bằng rehash rồi gọi evidence verified.

### Fix đề xuất

Ưu tiên persisted migration/backfill đã được handoff từ trước:
1. Projection readiness rõ ràng theo mission/version.
2. Backfill toàn bộ history theo original persisted order, dưới locks/maintenance boundary phù hợp.
3. Validate original canonical bytes/hash/schema trước derive projection.
4. Không mutate global ledger để repair tamper.
5. Persist companion entries và mission head/count atomic.
6. New append không bắt đầu một scoped chain bỏ historical entries khi mission chưa migration-ready.
7. Export chỉ đọc ready persisted representation, đúng checkpoint/scope/version.
8. Mixed/incomplete projection → explicit not-ready/integrity error, không auto-blend.
9. Nếu vẫn cần legacy-derived export:
   - Format/namespace khác và provenance rõ.
   - All source entries validate trước.
   - Ordering deterministic theo original order.
   - Không mix trusted persisted root với freshly generated root.
   - Không gọi derived root là persisted checkpoint hoặc global inclusion proof.
10. Canonical/hash algorithm pin; owner can verify against prior trusted checkpoint.
11. Checkpoint timestamp không dùng mission.createdAt như thể đó là thời điểm checkpoint mới được xác lập.

Tests phải gọi actual proof handler/backfill:
- Full legacy.
- Full projected.
- Mixed old NULL sequence + new seq=1.
- A→B→A interleaving.
- Tampered global canonicalJson vs entryHash.
- Tampered companion bytes vs missionEntryHash.
- Prior checkpoint comparison sau append hợp lệ.
- Repeated export cùng snapshot → same bytes/root, không hidden rewrite.
- No writes và authorization tests cũ vẫn pass.

Mapping: E1/E2/E8/E9; V4-03/V4-05, R07/R14.

## 5. Những phần được đóng ở mức nào

| Hạng mục | Đánh giá review |
|---|---|
| Actual service test cho active foreign lease | Pass trong current unit suite; cải thiện thật |
| Unauthorized proof GET zero writes | Pass trong current unit suite; source không còn updates trong GET |
| RepeatableRead cho proof/audit | Có trong source; real PG concurrent snapshot gate chưa chạy |
| Client pending/idempotency | Có sửa; pre-sign retry orchestration còn M5-01 |
| Migration missing receipt => MOCK | Predicate đã bỏ; upgrade vẫn fail M5-02 |
| Legacy export continuous fixture | Full-legacy case pass; mixed/tampered cases fail semantics M5-03 |
| Direct production tests | Đã có thực sự, không tiếp tục nói toàn bộ là model-only |
| Next supported version | Vẫn OPEN/PARTIAL; report nói Next14 đang maintenance là không đúng support snapshot đã research |
| Real PostgreSQL / browser / Foundry / Fuji | Chưa xác minh trong review này |

Không cần làm lại các sửa đã pass. Thêm cases còn thiếu vào direct tests hiện có.

## 6. Prompt giao Gemini

~~~text
Đọc GEMINI_ROUND5_REVIEW_AND_FIX.md.
Giữ các cải tiến current tests/typecheck/build; không reset working tree.

Chỉ tập trung ba blockers có evidence:
M5-01: orchestrator retry dispatch theo state. CREATED phải reserve rồi sign, RESERVED phải sign, FAILED là terminal DTO. Không bypass executor guards.
M5-02: normalize/archive legacy synthetic mock receipt trước mode-aware CHECK. Chạy actual SQL upgrade fixtures, không chỉ assert text migration.
M5-03: không blend/reorder persisted và regenerated projections. Validate source hashes; backfill persisted có readiness/version, hoặc explicit separate legacy-derived format với proper provenance.

Tests phải gọi production handlers/services/actual SQL.
Giữ zero-write unauthorized GET, active lease suppression, scope/privacy và terminal immutability.
Không sửa tests thành yếu hơn, không reset DB/pending ops, không cài system tools hoặc sửa WSL/Postgres.
Không commit/push/deploy/send funds nếu chưa được giao.

PGlite in-memory đã có thể chạy actual SQL constraints mà không cần daemon, nhưng chỉ coi đó là embedded SQL test.
Real PostgreSQL locking/integration, browser, Foundry và live Fuji vẫn separate gates.

Bàn giao 3 finding dispositions với source lines và exact tests:
- CREATED/RESERVED/FAILED retry actual handler.
- Legacy MOCK SETTLED upgrade actual migrations.
- Mixed + tampered legacy proof actual handler.

Đừng tuyên bố chỉ còn thiếu live environment trước khi ba cases này pass.
~~~

## 7. Reproduction SQL upgrade — không daemon, không disk DB

Dùng installed dependency; không npm install.
Local README của @electric-sql/pglite xác nhận new PGlite() là ephemeral in-memory.
Không dùng test này thay locking tests với real PostgreSQL.

~~~powershell
@'
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(fs.readFileSync(
   'apps/web/prisma/migrations/20261104000000_init/migration.sql','utf8'
  ));
  await db.query(
   'INSERT INTO "Mission" ("slug","missionId","ownerAddress","agentAddress",'+
   '"treasuryCap","toolCap","spentTool","reservedTool","expiresAt","status",'+
   '"policyHash","updatedAt") VALUES '+
   "('legacy-mock','legacy-id','owner','agent',10000000,5000000,500000,0,"+
   "'2026-11-06','ACTIVE','policy',CURRENT_TIMESTAMP)"
  );
  const row={
   operationId:'11111111-1111-4111-8111-111111111111',
   deploymentId:'legacy-deployment',missionSlug:'legacy-mock',
   payerAddress:'agent',toolId:'tool:summary',inputHash:'input',
   paymentTerms:'{}',paymentTermsHash:'terms',policyHash:'policy',
   chainId:43113,asset:'usdc',state:'SETTLED',authDeploymentVersion:1,
   quoteExpiresAt:'2026-11-06T00:00:00Z',reservedAmount:'0',
   authFrom:'agent',authTo:'seller',authValue:'500000',authNonce:'nonce',
   validAfter:0,validBefore:2000000000,authSignature:'mock_signature_for_testing',
   heldResult:'{"summary":"legacy fixture"}',heldResultHash:'result-hash',
   txHash:'mock:11111111-1111-4111-8111-111111111111',
   receiptBlockNumber:1000,receiptBlockHash:'legacy-fake-block',
   authorizationLogIndex:0,transferLogIndex:1,updatedAt:'2026-11-04T00:00:00Z'
  };
  const keys=Object.keys(row);
  await db.query(
   'INSERT INTO "ToolOperation" ('+
   keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+
   keys.map((_,i)=>'$'+(i+1)).join(',')+')',
   Object.values(row)
  );
  console.log('LEGACY_FIXTURE_ACCEPTED_BY_INITIAL_SCHEMA');
  try{
   await db.exec(fs.readFileSync(
    'apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql','utf8'
   ));
   console.log('UPGRADE_PASS');
  }catch(e){
   console.log('UPGRADE_FAIL',JSON.stringify({
    code:e.code,constraint:e.constraint,message:e.message
   }));
  }
 }finally{await db.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
'@ | node -
~~~

## 8. Direct handler retry reproduction

Process-only JWT secret fixture; không production keys.
DB mock chỉ trả existing operation, không mutate user database.

~~~powershell
$env:TSX_TSCONFIG_PATH='apps/web/tsconfig.json'
@'
const {prisma}=require('./apps/web/lib/db.ts');
const {POST}=require('./apps/web/app/api/tools/orchestrate/route.ts');
const {issueSpendToken,computePayloadHash}=require('./apps/web/lib/auth.ts');
const {NextRequest}=require('next/server');
process.env.APP_ORIGIN='http://localhost';
process.env.DEPLOYMENT_ID='review-fixture';
process.env.MISSION_TOKEN_SECRET='isolated-fixture-secret-longer-than-thirty-two';
process.env.PAYMENT_MODE='MOCK';
(async()=>{
 const token=await issueSpendToken({
  deploymentId:'review-fixture',stage:'S1',authVersion:1,
  missionSlug:'mission-a',missionId:'0x'+'1'.repeat(64),
  ownerAddress:'0x'+'2'.repeat(40),agentAddress:'0x'+'3'.repeat(40),
  missionConfigVersion:1,policyHash:'0x'+'4'.repeat(64),
  missionExpiresAt:new Date(Date.now()+3600000),appOrigin:'http://localhost'
 });
 const input={text:'retry fixture'};
 for(const state of ['CREATED','RESERVED','FAILED']){
  const op={
   operationId:'11111111-1111-4111-8111-111111111111',
   missionSlug:'mission-a',toolId:'tool:summary',
   inputHash:computePayloadHash(input),state,paymentMode:'MOCK'
  };
  prisma.toolOperation.findUnique=async()=>({...op});
  const res=await POST(new NextRequest('http://localhost/api/tools/orchestrate',{
   method:'POST',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify({
    operationId:op.operationId,toolId:op.toolId,arguments:input
   })
  }));
  console.log('RETRY',JSON.stringify({
   state,status:res.status,body:await res.json()
  }));
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

## 9. Completion report requirements

Ghi riêng:
1. SOURCE_CHANGED.
2. HANDLER/SERVICE_VERIFIED_WITH_MOCKS, có direct targets.
3. EMBEDDED_SQL_VERIFIED cho PGlite constraints/migration.
4. DB_VERIFIED chỉ sau actual PostgreSQL integration.
5. BROWSER_VERIFIED sau actual UI flow.
6. FOUNDRY_VERIFIED sau compile/test.
7. LIVE_VERIFIED sau Fuji receipts/balances.
8. OPEN/BLOCKED/PARTIAL cho phần còn lại.

Mỗi M5 có actual expected/actual, test file và command; không dùng client generation hoặc build thay SQL/migration test.
Giữ scope S1-first, không thêm feature để né sửa invariants.

## 10. SHA-256 của source được review

Hash theo raw file bytes; giúp nhận biết code đã drift dù HEAD giữ nguyên.

| File | SHA-256 |
|---|---|
| apps/web/lib/payments.ts | 94c8beb1b2fe03477d2f895a43a6e4ecdf73aebd9e98ff91714fad7acf29dc9f |
| apps/web/app/api/tools/orchestrate/route.ts | b9a4793a9735299ef01711f76f69328d92a974e8058fff7f8fcb825201e63f02 |
| apps/web/app/api/missions/[slug]/proof/route.ts | cca8b9d770a64482a2f7f300eec63848c39ce037c1b7cfb4774d2ad650415ce5 |
| apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql | 421871d8419448610765bbe69db469b21655f900478f1c3957739c3aab571b09 |
| apps/web/tests/unit-boundaries.test.ts | 1f3cf844b1cef658324e8d996a6545296b79717e9a71fd7bea03f40866a01a41 |

