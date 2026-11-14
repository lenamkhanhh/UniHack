# UniHack — Review lần 3 và handoff sửa các blockers còn lại

Ngày review: 2026-11-04.
Repository: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: d247015ee855f7ef48297ea9f49c606346efa690, branch main.
Đối tượng: bản mới của REPORT_REVIEW_AND_FIX_COMPLETION.md tham chiếu handoff vòng 2.
Implementation vẫn uncommitted; HEAD không đủ định danh code được review.

Lượt review chỉ đọc source, chạy checks/probes và tạo file Markdown này. Không sửa app/contracts/schema, không commit/push/deploy.

## 0. Kết luận

**Chưa nghiệm thu S1 và chưa chấp nhận các nhãn LOCAL_VERIFIED cho toàn bộ R/G2.**

Có cải tiến thực sự:
- 20/20 unit tests pass.
- Independent TypeScript check pass.
- Production build pass.
- Đã sửa impossible COMPLETE/feedback schema và thêm JWT issuer/required claims/context checks.
- Duplicate tick catch đã có required scoped identifiers.
- RPC đọc nonce pin blockNumber và receipt timestamp lấy đúng receipt block.
- Có publication action/flag và companion mission audit fields.
- Facilitator envelope có paymentPayload/paymentRequirements và đọc transaction.

Nhưng còn blockers code/flow, không phải chỉ thiếu live environment:
1. Stale worker vẫn có thể commit result sau khi lease bị worker khác lấy.
2. Timeout response có thể reopen terminal SETTLED thành UNKNOWN.
3. Demo trỏ sai endpoint, đọc sai token field, gửi tool request sai contract.
4. Forward migration tự relabel history sang LIVE_FUJI và không backfill mission audit.
5. Public audit vẫn xuất filtered global chain không hợp lệ.
6. Companion mission append làm phát sinh lại lock inversion.
7. Facilitator requirements còn thiếu fields quan trọng.
8. Report dùng unit/build/source changes thay cho DB/HTTP/browser evidence.

## 1. Kết quả kiểm chứng thực tế

| Check | Result trong review |
|---|---|
| Unit boundaries | 20/20 pass, 49ms trong lần chạy reviewer |
| Independent tsc | Exit 0 |
| Next production build | Exit 0; có ECONNREFUSED 127.0.0.1:55432 lúc page-data generation |
| Route inventory | 22 route files, thêm publish; report vẫn nói 21 |
| Full PostgreSQL integration | Không chạy trong lượt này; chưa có evidence mới |
| Forge | Không có executable; không compile/run contracts |
| L1/L2 Fuji | Không chạy |
| Stale lease probe, mock DB/HTTP, virtual clock | Hai computes, hai submits; result của stale worker A được commit |
| Terminal timeout probe | SETTLED bị ghi thành UNKNOWN |
| Historical mode probe | Stored MOCK nhưng return mode LIVE_FUJI theo runtime env |
| Source editing | Không; chỉ thêm tài liệu review này |

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

Ngoài ra: scoped rg/Get-Content/Python JSON reads; hai in-memory Node probes; read-only Get-Command forge.
Command block có Get-Command forge cuối trả exit 1 do forge unavailable; không hiểu nhầm thành Node probe không tái hiện.
No real DB, RPC, facilitator submission hoặc private key được dùng trong probes.

## 2. Findings ưu tiên

### T01 — HIGH: lease mới chưa có fencing ownership

Source: apps/web/lib/payments.ts:475–540.

Code claim lease bằng updateMany và workerLeaseUntil là cải tiến. Nhưng persist result kiểm:
- state='SIGNED'.
- workerLeaseUntil >= now.

now là timestamp cũ của worker A lúc bắt đầu. Sau khi lease A hết, B nhận lease mới, leaseUntil(B) vẫn >= now(A), nên A vẫn có thể persist.
Không có leaseOwner/fencing generation match và không kiểm count của result updateMany.

Đã tái hiện bằng process riêng, mocked Prisma/HTTP và virtual clock:
~~~json
{
  "computes": 2,
  "submissions": 2,
  "committedResults": [{"summary":"stale-worker-A"}],
  "finalHeldResult": {"summary":"stale-worker-A"},
  "finalState": "UNKNOWN"
}
~~~

Fix:
- Persist leaseOwner + monotonically increasing lease generation hoặc version được winner claim atomically.
- Persist result phải match exact owner/generation/current state; kiểm affected row = 1.
- Stale/loser phải return current scoped operation, không tiếp tục submit.
- Lease expiry/renewal dùng current time và explicit policy; không dùng inequality với timestamp cũ làm identity.
- Reuse heldResult path cũng cần settlement submission ownership.
- Fresh worker có thể cần provider idempotency/recovery cho crash gap; lease không tạo exactly-once external side effect.
- Test A lease expires → B claims → A returns late → A cannot commit/submit; B can.
- Test result CAS count=0 → zero facilitator calls từ losing worker.

Mapping: R02, G2-04/G2-05/G2-06; P4/P14/P21/P22.

### T02 — HIGH: terminal state vẫn bị timeout response ghi đè

Source: apps/web/lib/payments.ts:636–660.

Sau fetch, cả success branch update SETTLING và timeout branch update UNKNOWN chỉ where operationId.
Giữa read trước network và update sau network, reconcile khác có thể đã SETTLED/FAILED.

Probe:
1. Worker đọc SIGNED có heldResult.
2. Giữ fetch pending.
3. Một worker khác chuyển op thành SETTLED.
4. Fetch cũ trả failure.
5. Code ghi UNKNOWN vô điều kiện.

Observed:
~~~text
TERMINAL_AFTER_STALE_TIMEOUT UNKNOWN
~~~

Fix:
- Mọi post-network write dùng state/version/submission-owner CAS.
- Never overwrite SETTLED/FAILED.
- CAS loser đọc current state và trả receipt/result đúng scope; không fabricate error hoặc initiate payment mới.
- Submission intent/lease bền vững trước call; resume cùng authorization/nonce.
- Không clear candidate receipt/finality vì response cũ đến muộn.
- Test cả late success và late failure sau terminal commit.

Mapping: R02/R15; P14/P21/P22/P23.

### T03 — HIGH: demo chưa thể hoàn thành workflow dù đã có fetch thật

Sources:
- apps/web/app/demo/page.tsx:87,150,206,213–219,249–261.
- apps/web/app/api/auth/challenge/route.ts.
- apps/web/app/api/missions/[slug]/activate/route.ts:68–71.
- apps/web/app/api/tools/[id]/route.ts.
- apps/web/app/api/policy/route.ts:18–31.

Các lỗi quan sát trực tiếp:
1. Demo POST /api/challenges; repo không có route đó. Route thật /api/auth/challenge.
2. Activate response là spendToken; demo đọc actResult.token → undefined.
3. Demo POST /api/tools/search với query trần. Handler/catalog dùng tool:search, yêu cầu operationId và payment lifecycle.
4. Không có orchestrator tạo signed paid retry nội bộ; không thể dùng một POST query thay quote/reserve/sign/settle.
5. Tick ngay sau start, trước 60 giây completed minute, nên bị chặn đúng bởi billing policy.
6. PolicyData UI đòi paymentMode/configuredOwner/deploymentId nhưng endpoint policy không trả các fields đó.
7. Agent address hardcode fixture, không bind configured agent key.
8. Deliverable hash hardcode ab... thay hash của actual deliverable.
9. Còn simulatedSignature fallback dù challenge thật không trả signature giả.
10. Chưa có browser evidence; build không kiểm những mismatches trên.

Fix:
- Typed API client/shared DTO từ contract thật, tránh tự đặt field names.
- Owner wallet required; không substitute default owner/test signature.
- Challenge endpoint và action payload consistent.
- Server-side orchestrator gọi cùng auth/payment services, giữ authSignature server-only.
- Browser chỉ submit authorized intent và poll current operation.
- Search→summary dùng actual results; fixture label vẫn giữ nếu tool chưa retrieval thật.
- TalkMeter UI đợi server-confirmed completed minute, hoặc explicit elapsed/pending; không bỏ 60s rule cho demo.
- Recovery path sau close/expiry và real proof download.
- Không success khi response chỉ là 202 UNKNOWN.
- Browser test với mock wallet trong test harness; actual production UI không dùng test key.
- Trước khi gọi R09 LOCAL_VERIFIED, chạy full route flow với real test DB; nếu blocked, ghi SOURCE_CHANGED/NOT_EXECUTED.

Mapping: R09/R15; G2-23/G2-24, V6/V9, P2/P9.

### T04 — HIGH: migration có thể relabel MOCK cũ thành LIVE_FUJI

Source:
- apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql:11–25.
- apps/web/lib/payments.ts:438–442,496–506.
- apps/web/lib/dto.ts:22.

ADD COLUMN paymentMode NOT NULL DEFAULT 'LIVE_FUJI' gán LIVE_FUJI cho mọi existing operation.
Repo trước đó có MOCK SETTLED rows với synthetic tx/block fields. Migration không classify chúng, và live CHECK chỉ yêu cầu fields non-null, nên legacy fake evidence có thể mang mode LIVE_FUJI.

Ngoài ra, early return SETTLED và lease-loser vẫn dùng runtime getPaymentMode thay op.paymentMode.

Probe early return:
~~~json
{"storedMode":"MOCK","returnedMode":"LIVE_FUJI"}
~~~

Fix:
- Forward migration plan classify legacy records theo evidence/provenance có thể chứng minh.
- Không mặc định unknown legacy rows là live verified. Unknown provenance phải explicit/unverified; không fabricated receipts.
- Backfill mock records nhận dạng được; giữ pending signed auth để recover, không reset.
- Mode-aware constraints có enum CHECK và phân biệt mockReceiptId với blockchain txHash.
- Mọi return, DTO, proof, signer/reconcile dùng immutable stored mode.
- Test env đổi sau quote/settle không relabel old op.
- Review historical txHash format/evidence trước export live proof.

Mapping: R13/R14; G2-28/G2-29.

### T05 — HIGH: migration chưa backfill mission audit nên history cũ biến mất khỏi export

Source:
- Forward migration:29–35 chỉ thêm nullable columns và index.
- apps/web/app/api/missions/[slug]/proof/route.ts:53–76.
- apps/web/lib/audit.ts:123–147.

Existing AuditEntry rows nhận missionSlug/missionCanonicalJson=NULL.
Existing missions nhận head zero/count zero.
Proof query where missionSlug=slug bỏ qua toàn bộ historical entries, dù operations cũ vẫn tồn tại.
Với migration mới, một history có payments có thể export empty mission chain/checkpoint.

Index missionSlug/missionSequence hiện không UNIQUE. Không có backfill/provenance hoặc trạng thái projection chưa ready.

Fix:
- Safe forward migration/backfill job theo persisted original order và canonical fields, không thay global chain.
- Seed mission projection checkpoint/count từ actual rows, không từ số operations.
- Đảm bảo sequence uniqueness và head update invariant.
- Data chưa backfilled → explicit unavailable/migration-required, không báo valid empty history.
- Fresh DB và upgrade fixture A→B→A + outstanding ops cần tests riêng.
- Record projection format/backfill boundary; không claim completeness của lịch sử chưa migrate.

Mapping: R07/R14; G2-19/G2-20/G2-29, E1/E2.

### T06 — HIGH: public audit vẫn filter global chain, owner proof không có consistent snapshot

Source:
- apps/web/app/api/audit/route.ts:67–78.
- apps/web/app/api/missions/[slug]/proof/route.ts:27–78.

Private mission export đã có companion fields là đúng hướng.
Nhưng public /api/audit lấy các published missions rồi map toAuditEntryDto trên original global entries.
Nếu A published, B private, global A1→B1→A2 thì public export A1,A2 vẫn đứt chain.
Nếu nhiều published missions, không thể gom nhiều independent mission roots thành một single chain bằng original global hashes.

Export queries đọc mission/head và entries bằng các statements không cùng consistent snapshot; concurrent append có thể làm checkpoint/count và entry list lệch nhau ngay cả với valid database.

Fix:
- Public response là bundles theo mission, mỗi bundle dùng persisted companion entries/checkpoint; hoặc một curated ledger riêng có schema/checkpoint thật.
- Không dùng single fake head cho filtered union.
- Read-only consistent transaction/snapshot cho head/count/entries; không giữ transaction qua RPC.
- Client/verifier parse version/scope rõ, không fallback giữa global và mission fields.
- Tests actual API export→standalone verifier, bao gồm concurrent append và publication A/B interleaving.
- Không chữa bằng cách cho verifier bỏ qua chain break.

Mapping: R07/R08; G2-19/G2-20/G2-21/G2-22, E2/E8/E9.

### T07 — HIGH: companion append tạo lại deadlock order

Source:
- apps/web/app/api/propose/route.ts:74–95 khóa AuditHead nhưng không Mission.
- apps/web/lib/audit.ts:123–147 update Mission trong append.
- reserve/reconcile paths khóa Mission rồi AuditHead.

Một request BLOCK lấy AuditHead, sau đó đợi Mission.
Một reserve cùng mission lấy Mission, sau đó đợi AuditHead.
Đây là lock inversion; retry helper không thay thế thứ tự đúng.

Fix:
- Mọi caller append mission-scoped entry phải lock Mission trước AuditHead.
- API append nhận typed transaction context/locked mission thay vì giả định comment là lock thật.
- Global-only events không cần Mission update.
- Không thêm Mission FOR UPDATE bên trong helper sau AuditHead.
- Test blocked proposal và reserve/reconcile đồng thời trên real PostgreSQL.
- Check all audit callers, không chỉ payment helper.

Mapping: R02/R07/R14; G2-04/G2-20/G2-29, E1/P6/P22.

### T08 — HIGH: facilitator envelope đã sửa nhưng requirements chưa đủ

Source: apps/web/lib/payments.ts:597–603.

paymentRequirements hiện chỉ có scheme, network, maxAmountRequired, payTo, asset.
Thiếu resource, description, maxTimeoutSeconds của standard v1 requirements; domain-related extra cũng không được snapshot/forward.
Không có /verify before upstream. Paid route chủ yếu compare stored signature, không kiểm mọi auth time/context fields.

Nguồn: [x402 v1 §5.1 và §7](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v1.md).
Đây là static mismatch với pinned protocol, chưa được live test.

Fix:
- Persist exact offered requirements và send lại nguyên immutable snapshot.
- Không build requirements rút gọn từ amount/payTo.
- Validate all relevant authorization fields/domain/signature hoặc đúng SDK/verified adapter.
- /supported chỉ advertisement; actual /verify→compute→persist→settle→RPC finalization cần fixtures và L1.
- Handle success/network/payer/transaction and pending candidate consistently.
- Timer cleanup finally, redirect allowlist, không leak mission credential.
- Protocol fixture phải validate full request, không chỉ kiểm có ba wrapper keys.

Mapping: R03/R04/R15; G2-07/G2-08/G2-09, P2/P3/P5/L1.

### T09 — MEDIUM/HIGH: RPC batch binding và crash recovery chưa đủ evidence

Source: apps/web/lib/reconcile.ts:120–159; payments.ts recovery branches.

Đã sửa pin snapshot và receipt block timestamp, cần giữ lại.
Nhưng decoder vẫn giữ Transfer cuối cùng từ same authorizer, không match đầy đủ expected recipient/value tại selection hoặc gán transfer log cho đúng authorization trong batch.
Reader vẫn không thực hiện actual RPC chainId verification; chain metadata của viem client không thay RPC attestation.
Nonce used nhưng timeout mất txHash chưa có bounded auth/cancel log recovery.

Fix:
- Decode candidate log lists, select full match và prove pairing theo token behavior/receipt.
- Check no reused receipt/log binding across operations.
- Validate actual RPC chain and trusted asset.
- Timeout/no candidate + used nonce: recover event/receipt hoặc giữ UNKNOWN, không tự ký mới.
- Tests multi-transfer same-payer receipt và RPC outage/used-unknown path.
- Không gọi R04 LOCAL_VERIFIED chỉ vì added blockNumber field; cần adapter behavior tests.

Mapping: R04/R15; G2-10/G2-11/G2-12, P14–P20.

### T10 — MEDIUM: MOCK còn mang chain-shaped evidence và fake txHash

Source:
- apps/web/lib/payments.ts:547–564.
- Forward migration:19.

Block number/hash đã null là cải thiện.
Nhưng code vẫn gọi chain reconcile với isFinalized=true, AuthorizationUsed/Transfer logIndex=0 và txHash mock:...
Completion report ghi "không tạo bằng chứng blockchain giả" quá rộng so với behavior thực.

Fix:
- Discriminated evidence type MOCK/LIVE.
- Mock receipt ID riêng, chain receipt/log fields null.
- Dedicated simulated settlement path hoặc verifier rõ type; không đóng giả finalized chain.
- Public proof/DTO không tạo explorer link cho mock.
- Tests phải chạy service/DB transition, không chỉ DTO fixture có null block fields.

Mapping: R13; G2-28.

### T11 — MEDIUM: supported Next requirement còn open, không phải environment blocker

Source: apps/web/package.json; report R12 và G2-27.

Next vẫn 14.2.25. Breaking changes về async params là migration work, không chứng minh supported-version requirement đã đạt.
Report ghi R12 PARTIAL nhưng G2-27 LOCAL_VERIFIED, không nhất quán.

Nguồn: [Next support policy](https://nextjs.org/support-policy).
Nếu muốn chủ động giữ unsupported version theo tradeoff hackathon, cần decision rõ của owner; chưa có evidence owner đã chấp nhận tradeoff đó trong task sửa hiện tại.

Fix:
- Pin supported stable version và thực hiện route/runtime migration có tests.
- Không disable strict/typecheck hoặc downgrade auth checks để migrate.
- Nếu chưa làm, R12/G2-27 vẫn PARTIAL/OPEN; build pass chỉ là build pass.

### T12 — MEDIUM: LOCAL_VERIFIED vẫn đang dùng cho behaviors chưa chạy

20 unit tests mới chủ yếu kiểm pure helpers/DTO.
Test G2-19/G2-20 tự construct canonical objects; không gọi appendAuditEntry, real DB migration hoặc actual proof endpoint.
Không có HTTP/browser/concurrent-worker suite mới trong test inventory để chứng minh các claim R01/R02/R09/R14/R15.

Prisma generate chỉ tạo client types, không apply SQL hoặc prove invariants.
Build chỉ compile/package; không execute browser endpoints.
Report nói 21 API routes nhưng publish làm inventory thành 22.

Fix:
- Tách FIXED_SOURCE, UNIT_VERIFIED, DB_VERIFIED, HTTP_VERIFIED, BROWSER_VERIFIED, LIVE_VERIFIED.
- Mỗi gate map exact test path/assertion/command/exit, không dùng một helper test làm evidence cả architecture.
- Có thể giữ trạng thái ENVIRONMENT_BLOCKED cho DB/Foundry/live, nhưng source blockers ở trên vẫn OPEN.
- Không tự cho G2-30 LOCAL_VERIFIED khi report còn unsupported completion claims.

## 3. Hướng sửa theo thứ tự

1. T01/T02: correct fencing identity và conditional post-network writes; giữ terminal immutable.
2. T07: audit lock order sau khi thêm mission projection.
3. T04/T05: safe history classification/backfill; không reset existing database.
4. T06: actual scoped/public bundles và consistent export snapshot.
5. T08/T09: full v1 terms/verify adapter và receipt/recovery binding.
6. T03: typed route contract + server orchestrator + real wallet flow + elapsed TalkMeter.
7. T10/T11: honest mock evidence và supported dependencies.
8. T12: rerun checks/evidence; rewrite completion report.

Không sửa protected caps, UTC-day, no-auto-refill hoặc owner soft override để tránh bugs.
Không cho frontend giữ agent key hay authSignature để làm paid request dễ hơn.

## 4. Regression tests phải có thêm

| ID | Scenario | Expected |
|---|---|---|
| H3-01 | A lease expires, B claims, A returns late | A cannot persist result or submit |
| H3-02 | Result CAS affects 0 rows | No subsequent facilitator call |
| H3-03 | Another worker SETTLED while fetch pending; old timeout returns | Remains SETTLED, result/receipt/counters unchanged |
| H3-04 | Another worker FAILED; old success returns | Terminal remains FAILED; no late state overwrite |
| H3-05 | Existing heldResult, concurrent settle workers | Submission ownership/recovery respected |
| H3-06 | Old mock rows upgrade to new schema | Never automatically relabel live verified |
| H3-07 | Runtime mode flips after quote/settle | All responses/proofs keep stored mode |
| H3-08 | Legacy global audit upgrade, A→B→A | Valid persisted mission projections or explicit migration-not-ready |
| H3-09 | Published A, private B, public audit | Valid scoped bundles, no private data |
| H3-10 | Append during export | Head/count/entries same consistent snapshot |
| H3-11 | BLOCK audit and reserve on same mission concurrently | Lock order correct, no unresolved deadlock |
| H3-12 | Strict facilitator fixture checks required v1 fields | Full exact stored terms sent |
| H3-13 | Multi-transfer receipt from same payer | Correct nonce/transfer assignment, no reused evidence |
| H3-14 | Browser production demo with test wallet harness | Actual route names/DTOs/payment/recovery work |
| H3-15 | TalkMeter immediately after start | Pending/no completed minute; no falsely marked success |
| H3-16 | No DB/forge/live environment | Explicit blocked; no fake evidence or system config changes |

H3 tests bổ sung cho G2 và 06 IDs, không thay thế chúng.
Pure mocks hữu ích để tái hiện service race; real PostgreSQL tests vẫn cần để chứng minh locking/CAS integration.

## 5. Deterministic stale-lease reproduction, baseline hiện tại

Process riêng; fake clock, in-memory Prisma methods và fake HTTP. Không dùng DB/keys/network.
Sau khi implementation đổi, harness cần thích ứng exact new schema; không mock away lease owner/generation rồi claim code mới lỗi.

~~~powershell
@'
const {prisma}=require('./apps/web/lib/db.ts');
const {executeUpstreamAndSettle}=require('./apps/web/lib/payments.ts');
const {computePayloadHash}=require('./apps/web/lib/auth.ts');
const {toolCatalog}=require('./apps/web/lib/tools.ts');
const RealDate=Date;let clock=RealDate.now();
global.Date=class extends RealDate {
 constructor(...args){super(...(args.length?args:[clock]))}
 static now(){return clock}
};
process.env.PAYMENT_MODE='LIVE_FUJI';
const input={text:'lease-race-fixture'};
let op={
 operationId:'lease-op',missionSlug:'mission-a',toolId:'tool:summary',
 state:'SIGNED',version:1,workerLeaseUntil:null,heldResult:null,
 paymentMode:'LIVE_FUJI',inputHash:computePayloadHash(input),
 authFrom:'0x'+'1'.repeat(40),authTo:'0x'+'2'.repeat(40),
 authValue:500000n,reservedAmount:500000n,
 authNonce:'0x'+'3'.repeat(64),validAfter:1n,validBefore:2n,
 authSignature:'fixture-only',asset:'0x'+'4'.repeat(40)
};
let aResolve,bResolve,aEntered,bEntered;
const aReady=new Promise(r=>aEntered=r),bReady=new Promise(r=>bEntered=r);
let computes=0,submissions=0;const commits=[];
prisma.toolOperation.findUnique=async()=>({...op});
function apply(data){
 for(const[k,v]of Object.entries(data))
  op[k]=k==='version'?op.version+v.increment:v;
}
prisma.toolOperation.updateMany=async({where,data})=>{
 let ok=(!where.state||where.state===op.state);
 if(where.OR)ok=ok&&where.OR.some(x=>
  x.workerLeaseUntil===null
   ?op.workerLeaseUntil===null
   :op.workerLeaseUntil!==null&&op.workerLeaseUntil<x.workerLeaseUntil.lt);
 if(where.workerLeaseUntil?.gte)
  ok=ok&&op.workerLeaseUntil!==null&&op.workerLeaseUntil>=where.workerLeaseUntil.gte;
 if(ok){
  apply(data);
  if(data.heldResult)commits.push(JSON.parse(data.heldResult));
 }
 return {count:ok?1:0};
};
prisma.toolOperation.update=async({data})=>{apply(data);return {...op}};
toolCatalog['tool:summary'].execute=async()=>{
 computes++;
 if(computes===1){aEntered();return await new Promise(r=>aResolve=r)}
 bEntered();return await new Promise(r=>bResolve=r);
};
global.fetch=async()=>{submissions++;return {ok:false}};
(async()=>{
 const a=executeUpstreamAndSettle({operationId:op.operationId,arguments:input});
 await aReady;
 clock+=31000;
 const b=executeUpstreamAndSettle({operationId:op.operationId,arguments:input});
 await bReady;
 aResolve({summary:'stale-worker-A'});await a;
 bResolve({summary:'current-worker-B'});await b;
 console.log(JSON.stringify({
  computes,submissions,committedResults:commits,
  finalHeldResult:JSON.parse(op.heldResult),finalState:op.state
 }));
})().catch(e=>{console.error(e.message);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

## 6. Prompt giao Gemini lượt tiếp theo

~~~text
Đọc GEMINI_ROUND3_REVIEW_AND_FIX.md, handoff vòng 2 và owning pipeline specs.
Giữ toàn bộ work hiện có; không reset/clean/force push.

20 unit tests, tsc và build đã pass, giữ các cải tiến đó.
Nhưng chưa đóng T01–T12 bằng nhãn LOCAL_VERIFIED.

Ưu tiên:
1. Exact lease owner/generation fencing, kiểm update count, CAS mọi post-network state writes.
2. Giữ SETTLED/FAILED immutable dưới late network response.
3. Fix audit lock inversion, legacy mode/history backfill và valid scoped public export.
4. Full x402 v1 immutable terms + actual verifier/recovery.
5. Sửa demo theo route/response thật, server-only orchestration, đợi server minute boundary.
6. Mode-aware mock receipts và supported Next.
7. Thêm H3 regressions và chạy HTTP/real-PG/browser checks khi có môi trường.

Không sửa PostgreSQL/WSL/system, không cài Foundry system-wide, không gửi transaction/deploy/live funds.
Không đưa agent key/signature ra frontend. Không reset pending/UNKNOWN data để tests xanh.
Không thay tests/spec thành yếu hơn. Không lấy generate/build/helper tests làm evidence DB/browser.
Nếu thiếu môi trường, tiếp tục phần độc lập và báo blocked chính xác.
Không tự commit/push nếu chưa được yêu cầu.

Bàn giao changed files, actual commands/exit logs, T/R/F/H3/G2/06 mapping và blockers.
Tách SOURCE_CHANGED, UNIT_VERIFIED, DB_VERIFIED, HTTP_VERIFIED, BROWSER_VERIFIED, LIVE_VERIFIED.
Đừng nói chỉ thiếu live keys nếu vẫn còn code blockers.
~~~

