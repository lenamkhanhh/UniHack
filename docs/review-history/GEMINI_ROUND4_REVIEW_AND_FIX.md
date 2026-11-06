# UniHack — Review lần 4: blockers còn lại và prompt sửa trực tiếp

Ngày: 2026-11-04.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: main @ d247015ee855f7ef48297ea9f49c606346efa690.
Implementation còn uncommitted; HEAD không đại diện toàn bộ source đang review.
Input: REPORT_REVIEW_AND_FIX_COMPLETION.md bản Vòng 3.

Lượt này chỉ review, chạy checks/probes và thêm tài liệu này. Không sửa app/contracts/schema, không commit/push/deploy.

## 0. Verdict và việc cần giao Gemini

**Chưa nghiệm thu S1.** Có tiến bộ thật, không cần làm lại scaffold:
- 29/29 unit cases pass.
- Independent TypeScript check pass.
- Production build pass.
- Source có exact worker owner check khi persist held result và terminal-state CAS sau network.
- Full v1 requirements fields đã được bổ sung.
- Demo đã dùng đúng challenge route/spendToken và có server orchestrator.
- Có public mission bundles, RPC chain-id/recipient/value checks và stored mode returns.

Nhưng phần còn thiếu không chỉ là keys/DB/live environment:
- Existing-result submission path bypass lease ownership.
- Proof GET có thể ghi DB trước authorization.
- Legacy projection/backfill vẫn sai và checkpoint stale.
- Migration coi absence of receipt là MOCK.
- Transaction không tự bảo đảm consistent multi-statement snapshot.
- Orchestrator idempotency và UI pending behavior chưa đúng.
- H3 tests mới tự mô phỏng logic bằng local objects, không gọi implementation tương ứng.

Prompt ngắn:
~~~text
Đọc toàn bộ GEMINI_ROUND4_REVIEW_AND_FIX.md và owning specs.
Giữ các sửa đúng, sửa V4-01–V4-08 bằng production service/handler tests thực sự.
Không thêm các test tự tính điều kiện giống implementation trên local object rồi gọi đó là regression coverage.
Prioritize: submission ownership/recovery → authorize-before-write → real legacy backfill/snapshot → migration provenance → idempotency/pending UI.
Không sửa hệ thống PostgreSQL/WSL, không reset DB/pending ops, không deploy/fund/commit/push khi chưa được giao.
Nếu thiếu DB/Foundry/live credentials, tiếp tục pure adapter/actual-handler tests với dependency mocks và báo DB/live blocked riêng.
Không claim chỉ còn thiếu live keys khi vẫn có source blockers.
Bàn giao disposition, actual commands, actual results và limitations.
~~~

## 1. Checks thực sự đã chạy

| Check | Result reviewer |
|---|---|
| Unit boundaries | 29/29 pass, 72ms |
| Independent tsc | Exit 0 |
| Next build | Exit 0; DB ECONNREFUSED ở 127.0.0.1:55432 trong generation |
| API route count | 23, report vẫn nói 22 |
| Real PostgreSQL integration | Không rerun; chưa có DB evidence mới |
| Foundry | Executable không có trong PATH |
| Live Fuji | Không chạy |
| Actual payment service probe, mocked dependencies | 2 facilitator calls khi lease thuộc existing-owner |
| Actual proof handler probe, mocked transaction | Unauthorized 401 sau 1 audit write và 1 mission write |
| Actual proof handler + independent verifier | First legacy export 200 nhưng head checkpoint mismatch |
| Source writes | Không; chỉ tạo Markdown này |

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

Ngoài ra: scoped source reads/search, read-only Get-Command forge, inline Node probes bên dưới.
Probes gọi implementation thật nhưng thay DB/HTTP bằng memory fixtures. Chúng chứng minh control flow/predicate issues, không chứng minh actual PostgreSQL concurrency hoặc live exploit.

## 2. V4-01 — HIGH: existing heldResult path không claim submission ownership

Sources:
- apps/web/lib/payments.ts:472–509.
- apps/web/lib/payments.ts:620–724.

Code chỉ claim submission khi:
- heldResult tồn tại.
- state vẫn SIGNED.

Nếu state đã SUBMITTING, SETTLING hoặc UNKNOWN:
- Tạo leaseOwner UUID mới.
- Bỏ qua claim.
- Vẫn fetch /settle.
- Post-network CAS match leaseOwner mới nên thường không update được record của owner cũ.
- Candidate hash từ request đó có thể không được persist.

Đã tái hiện actual service:
~~~json
{
  "facilitatorCallsWithoutOwningLease": 2,
  "storedOwner": "existing-owner",
  "finalState": "SUBMITTING",
  "dbUpdates": 2
}
~~~

Đây không nhất thiết tạo hai transfers vì cùng EIP-3009 nonce, nhưng gây duplicate submission, lãng phí facilitator work và mất recovery/candidate evidence.
Không dùng nonce uniqueness để thay submission coordination.

Fix:
1. Một acquireSubmissionLease() dùng cho mọi path, kể cả heldResult.
2. Caller không sở hữu active lease → chỉ đọc/reconcile/pending, không fetch.
3. SUBMITTING active lease phải trả pending. Không tự claim lại chỉ vì có result.
4. UNKNOWN/expired lease phải recovery trước: candidate receipt/nonce/events; không blind resubmit.
5. Nếu retry được phép, dùng exact persisted authorization và durable intent dưới new owner/generation.
6. Kiểm count của candidate-hash CAS. CAS loser không được làm mất candidate evidence đã broadcast; attach evidence bằng validated, idempotent rule không reopen terminal.
7. Chỉ một winner thực hiện external submit; stale worker không tiếp tục qua boundary.

Tests:
- Two calls trên op SUBMITTING có active existing-owner → zero facilitator calls.
- UNKNOWN với known candidate → reconcile, không submit mới.
- Expired lease takeover → một winner, result reuse, same nonce.
- GET chuyển op sang UNKNOWN trong lúc submit pending → late candidate không bị mất.
- Late success/failure sau terminal vẫn giữ terminal.

Mapping: T01/T02, R02, P4/P14/P15/P21/P22.

## 3. V4-02 — HIGH: proof authorization diễn ra sau transaction có writes

Sources:
- apps/web/app/api/missions/[slug]/proof/route.ts:27–103.
- Authorization tại lines 112–119.

GET được gọi là read-only snapshot nhưng bên trong có:
- tx.auditEntry.update().
- tx.mission.update().

Hai writes chạy và commit trước khi xét hasAuthorizedToken/publicPublished.

Actual-handler probe với private mission và legacy rows cần backfill:
~~~json
{"status":401,"auditWrites":1,"missionWrites":1}
~~~

Điều kiện: legacy/backfill branch được kích hoạt. Không khẳng định mọi unauthorized GET đều write.
Nhưng authorization boundary sai độc lập với tần suất branch đó xuất hiện.

Fix:
- Authentication/scope/publication checks trước mọi backfill/data mutation.
- GET proof là read-only.
- Backfill là explicit maintenance/migration action có quyền phù hợp, locks và provenance, không hidden side effect của viewer request.
- Unauthorized/private request không compute projection, mutate metadata hoặc thay checkpoint.
- Unknown/sai scope errors theo 05; tránh tiết lộ existence.
- Test spy DB writes = 0 cho missing token, wrong token, unpublished public request.
- Không giải quyết bằng cách cho GET luôn commit backfill rồi hide response.

Mapping: T05/T06, R07/R08, V11/E2/E8.

## 4. V4-03 — HIGH: legacy projection không thực sự được backfill đúng

Sources:
- Migration 20261104100000_round2_hardening:52–57.
- Proof route:42–100, 139–144.

Có ba lỗi khác nhau:

### A. Migration làm backfill branch không chạy

Migration chỉ điền missionSlug từ canonicalJson; không điền missionSequence, missionEntryHash, missionCanonicalJson hoặc mission head/count.

Proof query where missionSlug=slug trả existing rows.
Guard entries.length === 0 trở thành false, nên không project các rows đã có missionSlug nhưng companion fields còn NULL.
Export fallback về global fields, tái tạo chain-break bug cũ.

### B. Mixed old/new history bị bỏ qua

Nếu có một new projected row, entries.length > 0.
Các legacy rows chưa project không được xử lý, dẫn tới omission hoặc mix namespaces trong export.
Cần check projection readiness/invariants, không dùng số lượng rows làm readiness flag.

### C. First on-the-fly export dùng stale mission object

Nếu branch backfill chạy:
- tx.mission.update ghi head/count mới.
- Function vẫn return mission object đọc trước update.
- Checkpoint dùng old nonempty zero-hash string.
- Count có thể fallback, nhưng head không fallback vì zero-hash string truthy.

Actual handler public legacy fixture:
~~~text
HTTP 200
verifyProof.valid = false
Head hash mismatch: checkpoint zero != computed mission hash
~~~

Fix:
1. Không backfill trong GET.
2. Một deterministic persisted backfill theo original order, với per-mission lock/readiness marker.
3. Preserve original global chain bytes/hashes.
4. Project tất cả legacy rows theo namespace/version, không chỉ cases entries empty.
5. Backfill mission head/count từ actual projected rows.
6. Index uniqueness là backstop; concurrent migration/append phải coordinated, không duplicate sequences.
7. Export fail rõ projection-not-ready nếu chưa migrate, không trả valid empty hoặc mix global/scoped fallback.
8. Không dùng truthiness để chọn checkpoint/hash khi zero-hash là giá trị có nghĩa.
9. Test fresh history, full legacy, migration-only missionSlug, mixed old/new và interleaved A→B→A.
10. First export và subsequent export phải cùng valid proof/schema semantics.

Mapping: T05/T06, R07/R14, E1/E2.

## 5. V4-04 — HIGH: migration gán MOCK cho mọi record thiếu receipt

Source:
apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql:16–22.

Predicate:
~~~sql
paymentMode IS NULL AND
(txHash LIKE 'mock:%' OR receiptBlockNumber IS NULL)
~~~

Một LIVE operation ở CREATED/RESERVED/SIGNED/UNKNOWN hoặc facilitator timeout bình thường chưa có receiptBlockNumber.
Nó sẽ bị classify MOCK dù có live authorization outstanding.

Đây là absence of evidence, không phải evidence of mock.
Mode-aware CHECK chỉ kiểm membership/shape, không làm mode immutable và không chứng minh provenance.

Fix:
- MOCK chỉ khi explicit provenance chứng minh: historical mock marker hoặc trusted mode metadata.
- Absence of receipt không được suy MOCK.
- Ambiguous legacy records cần explicit unverified/pending-classification hoặc staged migration; không forced live/mock verified.
- Signed/UNKNOWN live exposure vẫn recover đúng auth/nonce; không simulated settle.
- Nếu phải operator classify, cung cấp inspect/report và transition có audit; không tự đoán.
- Không edit migration đã apply rồi coi DB đã đổi. Kiểm history; forward changes riêng.
- Test upgrade fixture có old mock SETTLED, real LIVE SIGNED/UNKNOWN, real LIVE SETTLED, ambiguous row.

Mapping: T04/T10, R13/R14, P14/P15/P25.

## 6. V4-05 — HIGH: transaction wrapper không bảo đảm consistent snapshot

Sources:
- Proof route:28,103.
- Audit route private branch:23–32.
- Audit public branch:53–92.

Các queries không specify isolation level hoặc thiết kế atomic snapshot tương đương.
PostgreSQL mặc định READ COMMITTED: successive SELECTs có thể thấy commits khác nhau dù cùng transaction.
Nguồn primary: [PostgreSQL 18 — Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html).

Vì thế comment "Atomic read-only snapshot" không tự tạo guarantee.
Public bundles còn đọc heads trước rồi Promise.all đọc entries ngoài transaction.

Fix:
- Sau auth/readiness checks, dùng read-only consistent snapshot với isolation phù hợp, ví dụ RepeatableRead cho export, qua API hỗ trợ ở pinned Prisma.
- Không có writes/backfill trong export transaction.
- Head/count/entries và relevant publication state lấy cùng snapshot.
- Không giữ DB transaction qua RPC hoặc file download.
- Test controlled concurrent append/publication toggling giữa head read và entries read.
- Validate emitted head/count/chain trước khi gọi bundle verified.

Mapping: T05/T06, G2-20/G2-21, E2/E8.

## 7. V4-06 — HIGH/MEDIUM: idempotency và pending UI chưa end-to-end

Sources:
- orchestrate/route.ts:48,83–92.
- tools/[id]/route.ts:87–95.
- demo/page.tsx:215–247,292–347.

### Idempotency

Orchestrator tự randomUUID khi caller thiếu operationId.
Demo không gửi operationId.
Lost response/retry cùng user intent có thể thành purchase mới, không có stable key để recover.

Fix:
- Client tạo UUID một lần cho purchase intent, giữ xuyên retry.
- Orchestrator yêu cầu explicit operationId hoặc idempotency key bền vững.
- Same ID + exact scope/input/terms → same op; mismatch → conflict.
- Không retry bằng random ID khi timeout.

### UNKNOWN bị coi là success

Orchestrator trả HTTP 200 dù state UNKNOWN/SETTLING.
Demo chỉ kiểm response.ok rồi set search SUCCESS.
GET operation failure cũng bị bỏ qua nếu response non-ok.
Sau đó có thể hash deliverable với searchResults:null và mark complete.

Fix:
- Pending status DTO/HTTP nhất quán; UI kiểm state, không chỉ res.ok.
- UNKNOWN hiển thị pending/exposure/reason, poll scoped GET với bounded policy.
- Không complete paid deliverable nếu prerequisite result chưa có.
- GET error phải hiển thị, không silently ignore rồi success.
- Summary và successful TalkMeter minute billing vẫn cần thực hiện nếu claim full S1 demo; early tick rejection chỉ chứng minh guard, không chứng minh billing.
- Wallet cancel/HTTP error không advance step.
- Browser test drive real handlers/orchestrator với isolated test DB hoặc clearly labelled mocks.

Mapping: T03, P4/P14/P21/V9 và S1 demo gate.

## 8. V4-07 — MEDIUM: 9 H3 tests mới đang kiểm model tự viết, không implementation

Source: apps/web/tests/unit-boundaries.test.ts:877–1191.

Ví dụ:
- H3-01 tự tạo operationRecord rồi tự tính casMatches.
- H3-03 tự so settledOp.state với SUBMITTING.
- H3-12 tự tạo requirements object rồi assert fields của chính object đó.
- H3-13 logs.find trên synthetic decoded array, không gọi production chain reader.
- H3-15 tự Math.floor elapsed time, không gọi TalkMeter handler.

Imports hiện không có payments service, reconcile reader hoặc API route handler.
Số 29/29 pass là thật; coverage claims cho service/DB/browser không được chứng minh.

Yêu cầu thay đổi cách test:
1. Regression phải import và gọi production function/handler tương ứng.
2. Mock dependencies tại boundary (DB, RPC, HTTP, wallet), không copy predicate/algorithm vào test.
3. Assert observable state, counters, outbound calls và returned DTO.
4. Negative case có valid control.
5. Real PostgreSQL tests cho locking/transactions/migration vẫn separate gate.
6. Test có thể fail nếu bỏ/fix sai production guard; model-only tests không đạt tiêu chí này.
7. Không bỏ các pure DTO/canonical tests hữu ích; bổ sung đúng behavioral coverage.

Mapping: T12, toàn R/G2/H3 evidence.

## 9. V4-08 — MEDIUM: trạng thái còn open và report cần sửa

- API route files hiện 23, không phải 22.
- Next vẫn 14.2.25; F20/R12 đang OPEN/PARTIAL là đúng, chưa gọi supported stable.
- DB/Foundry/live blocked được ghi đúng, nhưng không đồng nghĩa local behavior đã hoàn tất.
- /verify-before-upstream, fully pinned terms/context và full adapter/recovery vẫn cần test trực tiếp.
- MOCK còn mock: trong txHash và finalized-like envelope; không gọi đó là real chain evidence.
- Các checks đã pass không được dùng thay browser/payment recovery/migration gate.

Report format:
- SOURCE_CHANGED.
- UNIT_VERIFIED: exact production unit/helper được gọi.
- HANDLER_VERIFIED_WITH_MOCKS.
- DB_VERIFIED.
- BROWSER_VERIFIED.
- LIVE_VERIFIED.
- BLOCKED / OPEN / PARTIAL.

Không dùng LOCAL_VERIFIED như một nhãn bao phủ mọi tầng.

## 10. Kiểm tra tiếp theo phải gọi code thật

| ID | Direct production target | Expected |
|---|---|---|
| J4-01 | executeUpstreamAndSettle, existing result + active foreign submit lease | Zero outbound settle |
| J4-02 | Recovery UNKNOWN/SETTLING paths | Reconcile before retry; candidate evidence retained |
| J4-03 | Proof GET, unauth/private legacy fixture | 401/404 theo contract; zero writes |
| J4-04 | Proof GET, first migrated legacy export | Valid actual exported checkpoint/chain |
| J4-05 | Backfill service/migration, mixed old/new rows | No omissions, correct persisted heads/sequences |
| J4-06 | Migration on LIVE SIGNED/UNKNOWN fixtures | Never infer MOCK from missing receipt |
| J4-07 | Export with concurrent append | Consistent head/count/entries snapshot |
| J4-08 | Orchestrator repeated same operationId/intent | One purchase; conflict for changed input |
| J4-09 | Demo receives 200/202 with UNKNOWN | Pending UI, no fake SUCCESS/complete |
| J4-10 | H3 rewritten to call implementation | Tests fail if production guard removed |

## 11. Reproduction: submission while lease belongs to someone else

Baseline process only, no DB/HTTP network:
~~~powershell
@'
const {prisma}=require('./apps/web/lib/db.ts');
const {executeUpstreamAndSettle}=require('./apps/web/lib/payments.ts');
const {computePayloadHash}=require('./apps/web/lib/auth.ts');
process.env.PAYMENT_MODE='LIVE_FUJI';
const input={text:'submission-ownership-fixture'};
let op={
 operationId:'owned-submit',missionSlug:'mission-a',toolId:'tool:summary',
 state:'SUBMITTING',heldResult:JSON.stringify({summary:'persisted result'}),
 paymentMode:'LIVE_FUJI',inputHash:computePayloadHash(input),
 workerLeaseOwner:'existing-owner',workerLeaseUntil:new Date(Date.now()+60000),
 workerLeaseGeneration:1,authFrom:'0x'+'1'.repeat(40),authTo:'0x'+'2'.repeat(40),
 authValue:500000n,reservedAmount:500000n,authNonce:'0x'+'3'.repeat(64),
 validAfter:1n,validBefore:2n,authSignature:'fixture-only',
 asset:'0x'+'4'.repeat(40),
 paymentTerms:JSON.stringify({resource:'http://fixture.invalid/tool',timeoutSeconds:60})
};
let calls=0;const updates=[];
prisma.toolOperation.findUnique=async()=>({...op});
prisma.toolOperation.updateMany=async({where,data})=>{
 updates.push(where);
 const matches=(!where.state||where.state===op.state)&&
  (!where.workerLeaseOwner||where.workerLeaseOwner===op.workerLeaseOwner);
 if(matches)Object.assign(op,data);
 return {count:matches?1:0};
};
global.fetch=async()=>{calls++;return {ok:false}};
(async()=>{
 await Promise.all([
  executeUpstreamAndSettle({operationId:op.operationId,arguments:input}),
  executeUpstreamAndSettle({operationId:op.operationId,arguments:input})
 ]);
 console.log(JSON.stringify({
  facilitatorCallsWithoutOwningLease:calls,
  storedOwner:op.workerLeaseOwner,finalState:op.state,dbUpdates:updates.length
 }));
})().catch(e=>{console.error(e.message);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

Nếu code đổi schema, adapt fake DB để model exact CAS semantics mới, không làm guard mới luôn pass/fail.
Đây là service control-flow reproduction; actual PG ownership/lock test vẫn bắt buộc khi có DB.

## 12. Reproduction: proof GET writes before auth và first export invalid

Gọi actual handler; transaction/rows in memory. Không actual DB mutation.
~~~powershell
$env:TSX_TSCONFIG_PATH='apps/web/tsconfig.json'
@'
const {prisma}=require('./apps/web/lib/db.ts');
const {GET}=require('./apps/web/app/api/missions/[slug]/proof/route.ts');
const {NextRequest}=require('next/server');
const {canonicalAuditJson,computeEntryHash,INITIAL_PREV_HASH:zero}
 =require('./apps/web/lib/audit.ts');
const {verifyProof}=require('./scripts/verify-proof.ts');
function fixture(published){
 let mission={
  slug:'private-a',missionId:'m-a',ownerAddress:'0x'+'1'.repeat(40),
  agentAddress:'0x'+'2'.repeat(40),operations:[],toolCap:5000000n,
  spentTool:0n,reservedTool:0n,status:'ACTIVE',publicPublished:published,
  auditHeadHash:zero,auditEntryCount:0
 };
 const canonicalJson=canonicalAuditJson({
  actor:'',amount:'0',chain_id:'43113',created_at:'2026-11-04T00:00:00.000Z',
  kind:'TOOL_RESERVED',mission_id:mission.slug,operation_id:'op-a',
  policy_hash:'',policy_version:'1',prev_hash:zero,reason:'fixture',
  result_hash:'',rule:'',source_key:'fixture:a',to:'',tx_hash:''
 });
 let row={
  id:1n,sourceKey:'fixture:a',canonicalJson,
  entryHash:computeEntryHash(canonicalJson),prevHash:zero,missionSlug:null
 };
 let auditWrites=0,missionWrites=0;
 const tx={
  mission:{
   findUnique:async()=>({...mission}),
   update:async({data})=>{
    missionWrites++;Object.assign(mission,data);return {...mission}
   }
  },
  auditEntry:{
   findMany:async({where})=>
    where.OR||row.missionSlug===where.missionSlug?[{...row}]:[],
   update:async({data})=>{
    auditWrites++;Object.assign(row,data);return {...row}
   }
  }
 };
 prisma.$transaction=async fn=>await fn(tx);
 return ()=>({auditWrites,missionWrites});
}
(async()=>{
 const stats=fixture(false);
 const privateRes=await GET(
  new NextRequest('http://localhost/api/missions/private-a/proof'),
  {params:{slug:'private-a'}}
 );
 console.log('UNAUTHORIZED_PROOF_WRITE',
  JSON.stringify({status:privateRes.status,...stats()}));
 fixture(true);
 const publicRes=await GET(
  new NextRequest('http://localhost/api/missions/private-a/proof?public=true'),
  {params:{slug:'private-a'}}
 );
 const data=await publicRes.json();
 console.log('FIRST_LEGACY_EXPORT',JSON.stringify({
  status:publicRes.status,verification:verifyProof(data.audit.entries,data.audit.checkpoint)
 }));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

Observed:
- UNAUTHORIZED_PROOF_WRITE: status 401, auditWrites 1, missionWrites 1.
- FIRST_LEGACY_EXPORT: status 200, verification.valid false, head hash mismatch.

## 13. Thứ tự sửa và completion protocol

1. V4-01: unify submission ownership/recovery, không chỉ compute lease.
2. V4-02: zero writes in proof GET, authorization trước access/mutation.
3. V4-03/V4-04: safe persisted migration/backfill theo provenance.
4. V4-05: read snapshot thật, public/private export consistency.
5. V4-06: stable idempotency keys + pending UI.
6. V4-07: tests gọi implementation thật.
7. V4-08: update report theo actual gates; giữ supported-version item open nếu chưa sửa.

Không tạo thêm business scope, không sửa caps/UTC/no-refill để tránh bugs.
Không reset DB hoặc xóa UNKNOWN ops.
Không tự deploy/fund/commit/push hoặc sửa PostgreSQL/WSL.

Completion mới phải có:
- Từng V4 disposition và file:line.
- J4 direct tests + 06 mapping.
- Actual commands/versions/exit results và limits.
- Typed proof/schema/migration decision và provenance.
- Gate nào vẫn blocked, gate nào thật sự verified.
- Uncommitted source manifest/hash nếu dùng HEAD để định danh không đủ.

