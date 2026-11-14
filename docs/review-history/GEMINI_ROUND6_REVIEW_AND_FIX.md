# UniHack — Review lần 6: hai audit blockers sau các bản sửa vòng 5

Ngày: 2026-11-05, Asia/Saigon.
Repository: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: main @ d247015ee855f7ef48297ea9f49c606346efa690.
Đối tượng: REPORT_REVIEW_AND_FIX_COMPLETION.md bản Vòng 5.

Lượt này chỉ review/check/probe và thêm tài liệu này. Không sửa app/contracts/SQL, không commit/push/deploy.

## 0. Kết luận và phạm vi

**Ba case vòng 5 đã có sửa và regression tests pass. Không cần làm lại các sửa đó.**

Đã xác nhận:
- 31/31 tests pass, bao gồm M5-01, M5-02 và M5-03.
- Independent TypeScript exit 0.
- Production Next build exit 0.
- SHA-256 các source chính khớp manifest trong báo cáo.
- SQL replay upgrade legacy MOCK receipt đã được thêm vào suite và pass.
- Retry CREATED/RESERVED có reserve/sign dispatch; FAILED có terminal DTO.
- GET proof reject tampered source và mixed projection thay vì silently blend.
- Unauthorized GET read-only, active foreign lease và context checks giữ lại.

**Chưa nghiệm thu hoàn toàn audit/proof slice. Còn hai case đã tái hiện:**

| ID | Severity | Finding |
|---|---|---|
| M6-01 | HIGH | Backfill mixed history fail UNIQUE khi gán seq=1 vào row cũ trong lúc row mới đã chiếm seq=1 |
| M6-02 | HIGH | Fully projected proof bị thiếu entries vẫn được xuất với root/count tính mới, bỏ qua persisted checkpoint |

Đây là hai edge cases trực tiếp thuộc phần audit/backfill đang sửa, không phải yêu cầu business mới.
Real PostgreSQL concurrency, browser, Foundry, L1/L2 và supported Next vẫn là gates riêng.

## 1. Evidence thực sự quan sát

| Check | Reviewer result |
|---|---|
| Unit/service/handler/embedded SQL suite | 31/31 pass; 10.235s execution trong lần reviewer |
| Independent TypeScript | Exit 0 |
| Production build | Exit 0; có DB ECONNREFUSED 127.0.0.1:55432 ở page generation |
| Report source manifest | Hashes của 6 files chính khớp source hiện tại |
| M6-01 actual backfill helper + actual SQL/index trên PGlite | Fail SQLSTATE 23505, AuditEntry_missionSlug_missionSequence_key |
| M6-02 actual proof handler + independent verifier, mock transaction | HTTP 200, persisted count 2 nhưng export count 1, verifier valid=true |
| Real PG integration/concurrency | Không chạy |
| Browser E2E / forge / live Fuji | Không chạy |
| Source modifications | Không; chỉ thêm Markdown này |

Commands chính:
~~~powershell
git rev-parse HEAD
git status --short -- .
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/tests/unit-boundaries.test.ts
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next build apps/web
git diff --check -- .
~~~

Ngoài ra: scoped reads, SHA-256 checks và inline node --require tsx/cjs probes.

Limits:
- PGlite dùng actual schema/migrations/UNIQUE constraint và gọi actual backfill helper qua một adapter transaction nhỏ. Không dùng real PostgreSQL daemon và không chứng minh lock/concurrency.
- Proof probe gọi actual handler với transaction rows giả lập. Nó chứng minh handler không đối chiếu checkpoint, không phải exploit against deployment.
- Không có real key, transaction chain hoặc user DB mutation trong probes.

## 2. M6-01 — HIGH: backfill mixed history va chạm sequence trước khi sắp lại

Sources:
- apps/web/lib/audit.ts:317–388.
- Update missionSequence từng row ở lines 356–373.
- Unique index AuditEntry_missionSlug_missionSequence_key trong forward migration.

Fixture:
1. Old row id=1 có missionSequence=NULL.
2. New row id=2 đã có missionSequence=1.
3. Cả hai thuộc cùng mission; global source hashes hợp lệ.
4. Backfill đọc id ASC và bắt đầu seq=1.
5. UPDATE old row thành seq=1 va chạm với row mới trước khi helper kịp chuyển row mới thành seq=2.

Observed:
~~~json
{
  "code":"23505",
  "constraint":"AuditEntry_missionSlug_missionSequence_key",
  "message":"duplicate key value violates unique constraint"
}
~~~

Impact:
- Proof mixed history hiện trả 409 yêu cầu backfill là đúng.
- Nhưng đường backfill được đề nghị để chữa mixed history lại fail.
- appendAuditEntry còn tự gọi backfill khi phát hiện legacy, nên append/payment/audit decision liên quan có thể rollback với lỗi này.
- Không thể coi backfill đã verified chỉ từ fixture tất cả sequence=NULL.

### Fix đề xuất

Giữ UNIQUE constraint, không drop index để né.

Một cách an toàn:
1. Explicit maintenance/backfill transaction, lock mission trước các tài nguyên khác theo chuẩn.
2. Read full source rows theo id, validate source bytes/hash/schema trước mutations.
3. Tính projection kế hoạch hoàn chỉnh trong memory.
4. Giải phóng existing sequence assignments trong cùng transaction bằng một pha chuyển tiếp hợp lệ:
   - Ví dụ set missionSequence=NULL cho đúng target mission rows rồi assign final sequences.
   - Hoặc temporary disjoint sequence range, sau đó final renumber.
5. Persist companion bytes/hashes/sequences và mission head/count atomic.
6. Commit chỉ sau tất cả invariants pass.
7. Failure ở giữa phải rollback mọi companion fields và head/count về trạng thái cũ.
8. Idempotent rerun không đổi bytes/root khi source không đổi.
9. Không sửa global canonicalJson/entryHash/sourceKey để repair.
10. Existing externally published checkpoints phải có migration/version/provenance policy rõ; không silently gọi rebuilt namespace là append-only continuation của một root không tương thích.

Caller contract:
- Admin wrapper phải bảo đảm locks/transaction; không dựa vào comment của tx:any.
- appendAuditEntry đã giữ mission lock phải dùng same transaction, không mở nested independent transaction.
- Không cho concurrent append chen vào giữa plan và apply.
- Không expose migration writes qua GET/public endpoint.

Tests:
- Old NULL sequence + new seq=1.
- Nhiều legacy rows xen projected rows, sequences có gaps.
- All legacy, all projected, rerun.
- Rollback sau forced update failure.
- Source integrity fail trước mọi writes.
- Concurrent append vs backfill trên real PostgreSQL khi có môi trường.

Acceptance: helper actual + actual UNIQUE index phải pass; không mock away unique constraints.

Mapping: M5-03, V4-03, E1/E2, G2-19/G2-20/G2-29.

## 3. M6-02 — HIGH: endpoint tự tạo checkpoint mới cho truncated persisted chain

Source:
- apps/web/app/api/missions/[slug]/proof/route.ts:129–161,184–189.

Hiện fully projected entries được lấy từ DB nhưng finalHeadHash/finalEntryCount luôn tính lại từ entries hiện đọc.
Không đối chiếu với mission.auditHeadHash và mission.auditEntryCount đã persist.

Fixture:
- Persisted mission head = hash(second), count=2.
- Query chỉ còn first entry, có source và companion hashes hợp lệ.
- Tail entry bị thiếu/deleted.
- Handler xuất root=hash(first), count=1.
- Verifier dùng chính checkpoint mới đó → valid=true.

Observed:
~~~json
{
  "status":200,
  "persistedCount":2,
  "exportCount":1,
  "persistedHeadMatchesExport":false,
  "exportValid":true
}
~~~

Claim giới hạn:
- Không nói hash chain ngăn được operator rewrite cả history lẫn mọi trusted checkpoint trước publication.
- Ở đây một persisted checkpoint cụ thể đã có và vẫn còn trong DB, nhưng API bỏ qua nó.
- Truncation/corruption vì thế bị "hợp thức hóa" thành checkpoint mới, trái acceptance E2.

### Fix đề xuất

Tách hai modes đã có:
1. Fully projected, persisted mission chain.
2. Explicit mission-legacy-derived, chưa có persisted scoped checkpoint.

Với fully projected:
- Kiểm sequence/sourceKey/inner-outer links/hash/canonical bytes đúng scope.
- Kiểm row count == persisted mission.auditEntryCount.
- Kiểm last computed head == persisted mission.auditHeadHash.
- Empty export chỉ hợp lệ khi persisted checkpoint thật sự là genesis count=0/head=zero.
- Checkpoint mismatch → integrity error (ví dụ HTTP 409), không rewrite root/count trong response.
- Return persisted checkpoint sau khi validate.
- Count không tự fallback bằng truthiness khi 0 là giá trị có nghĩa.
- Không dùng dữ liệu query subset làm trust anchor mới.
- Head/count/entries vẫn lấy cùng RepeatableRead snapshot.

Với pure legacy-derived:
- Giữ explicit ledgerScope riêng và provenance limitations.
- Validate original global source hashes trước derive.
- Không áp count=0/head=zero của uninitialized persisted mission projection vào legacy-derived chain như checkpoint có thẩm quyền.
- Không trộn mode để né mismatch của fully projected data.

Tests gọi actual handler:
- Fully projected valid two entries → 200 và persisted root/count.
- Missing last entry → 409.
- Missing all entries nhưng persisted count>0 → 409.
- Wrong mission head/count riêng từng yếu tố → 409.
- First/middle entry missing → 409.
- Duplicate/gap sequence/source identity → reject.
- Valid genesis mission → 200.
- Pure legacy-derived valid → giữ compatibility có schema/scope rõ.
- Tampered global/companion source và mixed projection tests cũ vẫn pass.
- Export chống expected checkpoint ở independent verifier.

Mapping: E2/E9; M5-03, V4-05, G2-20/G2-21.

## 4. Prompt giao Gemini — tập trung đúng hai case

~~~text
Đọc GEMINI_ROUND6_REVIEW_AND_FIX.md và owning audit/persistence specs.
Ba M5 fixes đã pass, giữ chúng; không làm lại payment/auth scaffold.

Sửa hai case đã tái hiện:
M6-01: actual backfill mixed NULL + existing seq=1 đang fail UNIQUE 23505.
Giữ UNIQUE, dùng transaction + mission lock + collision-free two-phase renumber, validate source trước writes, preserve global hashes.
M6-02: fully projected proof bị thiếu tail vẫn pass vì handler tính fresh root/count.
Phải validate against persisted mission head/count, reject mismatch; không tự tạo trust anchor thay thế.

Tests phải gọi actual backfill helper với real SQL/index (PGlite được cho embedded constraints) và actual proof handler.
Không mock away unique constraints hay tự tính predicates thay production code.
Giữ current 31 tests, strict tsc, build; thêm targeted regression cases.

Không reset DB/pending ops, không sửa PostgreSQL/WSL/system, không deploy/send funds/commit/push nếu chưa được giao.
Không drop index hoặc weaken verifier/spec để tests xanh.
Phân biệt EMBEDDED_SQL_VERIFIED, HANDLER_VERIFIED_WITH_MOCKS và real DB/BROWSER/FOUNDRY/LIVE gates.
Bàn giao disposition của M6-01/M6-02, test commands/results và source hash manifest.
~~~

## 5. Reproduction M6-01 — actual SQL/index + actual helper

Process in-memory; dependencies đã được cài trước đó. Không tạo DB trên disk, không sửa user PostgreSQL.

~~~powershell
@'
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const {
 backfillMissionAuditProjections,canonicalAuditJson,
 computeEntryHash,INITIAL_PREV_HASH:z
}=require('./apps/web/lib/audit.ts');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(fs.readFileSync(
   'apps/web/prisma/migrations/20261104000000_init/migration.sql','utf8'));
  await db.exec(fs.readFileSync(
   'apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql','utf8'));
  await db.query(
   'INSERT INTO "Mission" ("slug","missionId","ownerAddress","agentAddress",'+
   '"treasuryCap","toolCap","expiresAt","status","policyHash","updatedAt") VALUES '+
   "('legacy-a','legacy-id','owner','agent',10000000,5000000,"+
   "'2026-11-06','ACTIVE','policy',CURRENT_TIMESTAMP)");
  function c(key,prev,when){
   return canonicalAuditJson({
    actor:'',amount:'0',chain_id:'43113',created_at:when,
    kind:'TOOL_RESERVED',mission_id:'legacy-a',operation_id:key,
    policy_hash:'',policy_version:'1',prev_hash:prev,reason:'fixture',
    result_hash:'',rule:'',source_key:key,to:'',tx_hash:''
   });
  }
  const old=c('old',z,'2026-11-04T00:00:00.000Z');
  const oldHash=computeEntryHash(old);
  const globalNew=c('new',oldHash,'2026-11-04T00:01:00.000Z');
  const scopedNew=c('new',z,'2026-11-04T00:01:00.000Z');
  await db.query(
   'INSERT INTO "AuditEntry" ("sourceKey","prevHash","entryHash",'+
   '"canonicalJson","createdAt","missionSlug") VALUES ($1,$2,$3,$4,$5,$6)',
   ['old',z,oldHash,old,'2026-11-04T00:00:00Z','legacy-a']);
  await db.query(
   'INSERT INTO "AuditEntry" ("sourceKey","prevHash","entryHash",'+
   '"canonicalJson","createdAt","missionSlug","missionSequence",'+
   '"missionPrevHash","missionEntryHash","missionCanonicalJson") '+
   'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   ['new',oldHash,computeEntryHash(globalNew),globalNew,
    '2026-11-04T00:01:00Z','legacy-a',1,z,
    computeEntryHash(scopedNew),scopedNew]);
  await db.query(
   'UPDATE "Mission" SET "auditHeadHash"=$1,"auditEntryCount"=1 WHERE "slug"=$2',
   [computeEntryHash(scopedNew),'legacy-a']);

  async function update(table,key,id,data){
   const cols=Object.keys(data);
   return (await db.query(
    'UPDATE "'+table+'" SET '+
    cols.map((k,i)=>'"'+k+'"=$'+(i+1)).join(',')+
    ' WHERE "'+key+'"=$'+(cols.length+1)+' RETURNING *',
    [...Object.values(data),id])).rows[0];
  }
  const tx={
   mission:{
    findMany:async()=>(
     await db.query('SELECT * FROM "Mission" ORDER BY "createdAt"')).rows,
    update:async({where,data})=>update('Mission','slug',where.slug,data)
   },
   auditEntry:{
    findMany:async()=>(
     await db.query('SELECT * FROM "AuditEntry" ORDER BY "id"')).rows,
    update:async({where,data})=>update('AuditEntry','id',where.id,data)
   }
  };
  try{
   console.log('MIXED_BACKFILL_PASS',
    JSON.stringify(await backfillMissionAuditProjections(tx,'legacy-a')));
  }catch(e){
   console.log('MIXED_BACKFILL_FAIL',
    JSON.stringify({code:e.code,constraint:e.constraint,message:e.message}));
  }
 }finally{await db.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

Adapter chỉ triển khai methods helper hiện tại dùng. Khi helper được sửa dùng thêm bulk update/locking/transactions, update test adapter tương ứng hoặc dùng full SQL/Prisma integration.
Không biến missing adapter method thành false claim rằng fixed implementation còn lỗi.
Test atomic rollback cần transaction wrapper thật; probe này chủ yếu tái hiện collision UNIQUE.

## 6. Reproduction M6-02 — actual proof handler với missing tail

~~~powershell
$env:TSX_TSCONFIG_PATH='apps/web/tsconfig.json'
@'
const {prisma}=require('./apps/web/lib/db.ts');
const {GET}=require('./apps/web/app/api/missions/[slug]/proof/route.ts');
const {NextRequest}=require('next/server');
const {canonicalAuditJson,computeEntryHash,INITIAL_PREV_HASH:z}
 =require('./apps/web/lib/audit.ts');
const {verifyProof}=require('./scripts/verify-proof.ts');
function c(key,prev,when){
 return canonicalAuditJson({
  actor:'',amount:'0',chain_id:'43113',created_at:when,
  kind:'TOOL_RESERVED',mission_id:'mission-a',operation_id:key,
  policy_hash:'',policy_version:'1',prev_hash:prev,reason:'fixture',
  result_hash:'',rule:'',source_key:key,to:'',tx_hash:''
 });
}
const first=c('first',z,'2026-11-04T00:00:00.000Z');
const h1=computeEntryHash(first);
const second=c('second',h1,'2026-11-04T00:01:00.000Z');
const h2=computeEntryHash(second);
const mission={
 slug:'mission-a',missionId:'id-a',ownerAddress:'owner',agentAddress:'agent',
 operations:[],publicPublished:true,auditHeadHash:h2,auditEntryCount:2,
 createdAt:new Date('2026-11-04T00:00:00Z')
};
const onlyFirst={
 id:1n,sourceKey:'first',prevHash:z,entryHash:h1,canonicalJson:first,
 missionSlug:'mission-a',missionSequence:1,missionPrevHash:z,
 missionEntryHash:h1,missionCanonicalJson:first
};
prisma.$transaction=async fn=>await fn({
 mission:{findUnique:async()=>({...mission})},
 auditEntry:{findMany:async()=>[onlyFirst]}
});
(async()=>{
 const res=await GET(
  new NextRequest('http://localhost/api/missions/mission-a/proof?public=true'),
  {params:{slug:'mission-a'}});
 const data=await res.json();
 console.log('TRUNCATED_PERSISTED_PROOF',JSON.stringify({
  status:res.status,persistedCount:mission.auditEntryCount,
  exportCount:data.audit.checkpoint.entryCount,
  persistedHeadMatchesExport:mission.auditHeadHash===data.audit.checkpoint.headHash,
  exportValid:verifyProof(data.audit.entries,data.audit.checkpoint).valid
 }));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

Sau fix expected response là integrity error; regression test phải assert that và không cố parse missing success payload như script baseline.

## 7. Source SHA-256 xác nhận

Các hashes này khớp manifest báo cáo đầu vào:

| File | SHA-256 |
|---|---|
| apps/web/lib/payments.ts | 94c8beb1b2fe03477d2f895a43a6e4ecdf73aebd9e98ff91714fad7acf29dc9f |
| apps/web/app/api/tools/orchestrate/route.ts | 3070dcf572dc30883e034340f4c08defa30c81561fee5e5e90a9b572266928bb |
| apps/web/app/api/missions/[slug]/proof/route.ts | 79b3c2526b2d371469dd250238c32a31d4ff73d7cbbdeb3c786f6f9ea7ff60b6 |
| apps/web/lib/audit.ts | e5b40698e80fc9d41de9410d457b91e077612c6d86e94864fa0c9cde6fc3a48f |
| apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql | 46348c72d9d99154263e2c3608d9b882cdab3533e44d9b321337cbbc7d058215 |
| apps/web/tests/unit-boundaries.test.ts | 9ef3181e9e485c3f79142f14b0733c761913f2656b6678ae37ae461129586612 |

## 8. Completion gate sau lượt sửa

- M6-01 mixed backfill actual UNIQUE SQL passes, rollback/idempotency tests.
- M6-02 persisted checkpoint validation rejects missing entries/head/count/sequence corruption.
- Existing 31 tests, typecheck và build regressions vẫn pass.
- Report không gọi fake chain receipt là live evidence.
- Real DB concurrency/browser/Foundry/live vẫn ghi trạng thái đúng; không suy từ embedded SQL và handler mocks.
- Supported Next debt giữ OPEN nếu chưa có migration/approved scope decision; không mô tả Next14 là đang maintenance chỉ vì build pass.
- Không cần tạo thêm business features hay thay product direction để đóng hai findings.

