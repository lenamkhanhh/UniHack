# UniHack — Round 2 research, corrective implementation plan và prompt cho Gemini

Ngày: 2026-11-04.
Repository: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
Baseline review: main, HEAD d247015ee855f7ef48297ea9f49c606346efa690.
Implementation và các sửa vòng trước còn uncommitted.

Tài liệu này là handoff để Gemini sửa source. Lượt tạo tài liệu chỉ thêm file Markdown này, không implement app/contracts, không commit/push/deploy.

## 0. Prompt giao việc — đọc phần này trước

Bạn tiếp tục sửa UniHack sau báo cáo REPORT_REVIEW_AND_FIX_COMPLETION.md. Báo cáo đó chưa được nghiệm thu: unit tests và build có pass nhưng một số claim "ĐÃ XONG" không khớp source và probes độc lập. Nhiệm vụ là hoàn thiện implementation và kiểm chứng behavior, không chỉ cập nhật báo cáo.

Hãy đọc toàn bộ tài liệu này, GEMINI_REVIEW_AND_FIX_HANDOFF.md và các owning specs ở pipeline/ trước khi sửa. Dùng pipeline/06-tests-security.md làm acceptance matrix chính thức; IDs R01–R16 và G2-01–G2-30 trong tài liệu này chỉ bổ sung regression, không thay thế C/P/V/E/L.

Mục tiêu:
1. Sửa đường payment/auth/TalkMeter/proof S1 theo phần 4.
2. Làm một vertical demo thật qua production service boundaries.
3. Sửa typecheck, contract regression và dependencies; chạy checks phù hợp.
4. Chỉ ghi FIXED khi có source và evidence tương ứng; tách LOCAL VERIFIED khỏi LIVE VERIFIED.
5. Giữ product direction, caps, prices, UTC-day semantics và S1-first delivery.

Ràng buộc:
- Đọc AGENTS.md áp dụng và real execution path; status/diff/search scoped trong repo.
- Bảo toàn toàn bộ work hiện có; không reset --hard, clean -fd, overwrite work người khác hoặc force-push.
- Không sửa hệ thống PostgreSQL/WSL/firewall, kill Docker/process người dùng hoặc cài system tools.
- Không chạy scripts/setup-pg.sh.
- Không tạo/commit real wallet key; không đưa secrets/raw signatures/private results vào public evidence.
- Không gửi transaction, deploy contract, cấp allowance/refill hoặc tự provision paid service trong lượt source-only.
- Không tự commit/push khi chưa được giao. Hoàn thiện diff và evidence cục bộ trước.
- Có thể thêm project-local dependencies cần thiết; kiểm tương thích/pin exact version. Không nâng cả Prisma major chỉ vì docs mới dùng API khác.
- Missing DB/Foundry/live credentials là blocker môi trường; tiếp tục phần độc lập, báo chính xác, không fabricate stdout.
- Không đổi expected assertions hoặc owning spec để tests yếu hơn.
- Implementation choices và proposed schema trong tài liệu này là design recommendations; nếu chọn cách tương đương ít đổi hơn, chứng minh cùng invariants bằng tests.
- Không đưa security-review checklist không liên quan vào product UI.
- Không tự mở rộng S3/reputation/multisig/rolling cap hay đổi framework.
- Khi sửa schema/proof format để giải quyết vấn đề thực, cập nhật docs liên quan rõ ràng; không gọi weakened behavior là spec compliance.

Kết thúc bằng completion report mới ở mục 10; không tái sử dụng bảng 20/20 xanh bằng suy luận từ code compilation.

## 1. Nguồn owning specs và hiện trạng đã xác minh

Đọc:
- pipeline/11-gemini-handoff.md.
- pipeline/00-overview.md: constants, stage boundaries, topic ownership.
- pipeline/02-x402-tools.md: x402, identity/state machine, payment recovery, TalkMeter.
- pipeline/05-app.md: schema, atomic writes, owner/spend/read auth, API/runtime.
- pipeline/04-agent.md: validator, audit canonical encoding, proof claims.
- pipeline/06-tests-security.md: authoritative acceptance IDs.
- pipeline/01-contracts.md: GuardedTreasury.
- pipeline/08-build-plan.md: stage order.
- GEMINI_REVIEW_AND_FIX_HANDOFF.md: đầy đủ F1–F20 và 75 C/P/V/E/L IDs.
- REPORT_REVIEW_AND_FIX_COMPLETION.md: đối tượng cần kiểm chứng, không phải bằng chứng đúng tự thân.

### 1.1 Kết quả thực sự quan sát ở vòng review 2

| Check/probe | Actual result |
|---|---|
| Unit suite mới | 16/16 pass, khoảng 35ms trong lần chạy reviewer |
| Independent TypeScript | Exit 1, 17 errors trong unit-boundaries.test.ts |
| Production build | Exit 0; có DB ECONNREFUSED trong lúc generate pages |
| Full PostgreSQL P/V/E | Chưa rerun trong vòng 2 |
| Foundry | forge unavailable; chưa compile/run |
| Live Fuji L1/L2 | Chưa chạy |
| COMPLETE_MISSION với deliverableHash | Reject "Unknown field 'deliverableHash'" |
| PREPARE_FEEDBACK với required fields | Reject "Unknown field 'deliverableHash'" |
| Mission A proof từ global A→B→A | Verifier reject chain break |
| JWT ký bằng secret fixture, wrong issuer/stage/chain, không exp | verifyToken vẫn accept |
| Two execute calls, in-memory dependencies, same signed op | Upstream chạy 2 lần; hai SUBMITTING writes |
| Facilitator standard success fixture dùng transaction | Cả hai calls chuyển UNKNOWN vì code chỉ đọc txHash |
| SQL CHECK count | 16, không phải 17 như report |
| Git/source | Không sửa source trong review; HEAD không đổi |

Commands chính đã chạy:
~~~powershell
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/tests/unit-boundaries.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next build apps/web
git status --short -- .
git diff --check -- .
~~~

Các probes dùng mock dependencies trong memory, không phải exploit against live services. JWT probe dùng secret test, không chứng minh attacker biết production secret. Production build pass không phủ nhận independent typecheck fail.

## 2. Research primary sources và kết luận áp dụng

Context7 không có trong tool inventory của lượt này, nên nghiên cứu dùng primary documentation và local installed type declarations. Không copy API Prisma latest vào project Prisma 5.22.0.

| Ref | Primary source | Kết luận áp dụng, không suy quá nguồn |
|---|---|---|
| S1 | [x402 v1 specification §7](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v1.md) | Facilitator verify/settle nhận paymentPayload cùng paymentRequirements; standard settlement response có transaction. Giữ v1 wire contract nhất quán. |
| S2 | [Ultravioleta /supported](https://facilitator.ultravioletadao.xyz/supported) | GET trực tiếp trả HTTP 200 và công bố v1 exact Fuji USDC. Đây là capability advertisement tại thời điểm đọc, không phải payment success. |
| S3 | [Avalanche exchange integration — determining finality](https://build.avax.network/docs/primary-network/exchange-integration) | Accepted blocks đã final; latest thể hiện executed state. Không áp Ethereum confirmation assumptions máy móc. |
| S4 | [Viem readContract](https://viem.sh/docs/contract/readContract) | Có thể pin contract read vào block cụ thể. Local viem types cũng có blockNumber/blockHash/blockTag/requireCanonical. |
| S5 | [Prisma null and undefined](https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/null-and-undefined) | Với behavior mặc định liên quan project, undefined có thể làm filter bị bỏ. Validate required scope trước query, không dựa vào property chưa tồn tại. |
| S6 | [PostgreSQL 18 explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html) | Row locks sống trong transaction; acquire consistently và giữ transaction ngắn. |
| S7 | [jose JWTVerifyOptions](https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md) | Claim policies phải cấu hình/enforce; valid signature không tự xác lập application scope. |
| S8 | [Next.js support policy](https://nextjs.org/support-policy) | Next 14 đang unsupported. Build pass không đáp ứng supported-stable requirement. |
| S9 | [OpenZeppelin Contracts 5.x ERC20 utilities](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) | Dùng SafeERC20 chuẩn như owning spec; pin compatible compiler/library và test actual revert behavior. |
| S10 | [Prisma migration troubleshooting](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/troubleshooting) | Không sửa migration đã apply để giả rằng database tự cập nhật; cần xử lý migration history và forward changes. Không làm theo reset instructions trên DB người dùng. |
| S11 | [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009) | Random authorization nonce, validity window, used/canceled semantics. Bind signature và receipt với đúng authorization. |
| S12 | [Prisma versioned transaction docs](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) | Tham khảo concepts OCC/idempotency; project vẫn phải dùng API thực sự có trong installed Prisma 5.22.0. |

Local version evidence:
- node_modules/jose/dist/types/types.d.ts có issuer, requiredClaims, maxTokenAge và clockTolerance.
- node_modules/viem/_types/actions/public/readContract.d.ts có blockNumber/blockHash và related options.
- Installed lockfile trong review: Next 14.2.25, TypeScript 5.9.3, Vitest 2.1.9, viem 2.57.16, jose 5.10.0, Prisma 5.22.0.
- package.json semver range không phải bằng chứng exact installed version.

### 2.1 GET /supported: snapshot trực tiếp, không dùng search cache làm live evidence

Endpoint: https://facilitator.ultravioletadao.xyz/supported
Fetched at: 2026-11-04T13:10:03.6392132Z.
HTTP: 200.
SHA-256 của UTF-8 encoded decoded response content:
34acd3997cb0d1586cfc8b7ab67705830b3ba837a3e5e6835c55201c9eb5f103

Relevant advertised kind:
~~~json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "avalanche-fuji",
  "networkAliases": ["avalanche-fuji", "eip155:43113"],
  "extra": {
    "tokens": [{
      "token": "usdc",
      "address": "0x5425890298aed601595a70AB815c96711a31Bc65",
      "decimals": 6
    }]
  }
}
~~~

Response cũng công bố v2 exact cho eip155:43113. Không có lý do chuyển sang v2 chỉ để né sửa v1.
Gemini phải lấy snapshot mới lúc live spike; full raw response không được lưu trong lượt viết tài liệu này, nên digest ở trên chỉ hỗ trợ provenance của lần đọc, không thay thế raw artifact cho S0.
Không gọi /verify hoặc /settle và không gửi funds trong research này.

### 2.2 Điều chỉnh nhận định về Avalanche finality

Không giữ claim "latest luôn chưa final" hoặc "Fuji phải có 12 confirmations" như một chân lý kỹ thuật. Theo S3, accepted C-Chain block đã final và latest là executed state; safe/finalized có thể chậm hơn do settled state.

Lỗi chắc chắn của implementation hiện tại là đọc nonce state và block timestamp bằng hai latest reads không pin cùng snapshot. Còn receipt branch dùng timestamp của latest thay receipt block.

Design phải ghi rõ provider/chain semantics được dựa vào, kiểm network và snapshot identity. Manifest cũ ghi finalized-or-12-confirmations không được âm thầm thay bằng comparison latest.number >= receipt.blockNumber. Nếu chọn accepted/executed semantics cho Fuji, ghi ADR/manifest và tests tương ứng. Không thêm delay để che snapshot bug.

## 3. Bảng findings vòng 2

| ID | Severity | Mapping | Source snapshot | Tình trạng / impact |
|---|---|---|---|---|
| R01 | HIGH | F8/F12 | tick/route.ts:179–187 | Duplicate catch dùng req.sessionId/minuteIndex chưa gán; có thể lookup không scope rồi trả private result. |
| R02 | HIGH | F7/F9 | payments.ts:469–502 | Không có lease/CAS thực; hai workers compute và write cùng op. |
| R03 | HIGH | F4/F5 | payments.ts:562–574 | Sai facilitator request/response schema; standard success thành UNKNOWN. |
| R04 | HIGH | F5 | reconcile.ts:60–99,170–175 | Nonce/block inconsistent snapshot; receipt timestamp sai; batch/log assignment yếu. |
| R05 | HIGH | F6 | challenges.ts:18–25,93–114 | COMPLETE/PREPARE_FEEDBACK có required keys bị whitelist cấm. |
| R06 | HIGH | F3 | auth.ts:240–264 | Sai issuer/stage/chain và missing exp vẫn accept ở probe ký hợp lệ. |
| R07 | HIGH | F11/F12 | proof/route.ts:49–80 | Filter global chain theo mission làm links/checkpoint không còn hợp lệ. |
| R08 | HIGH | F12 | proof/route.ts:28; audit/route.ts | Public opt-in thực chất slug convention; public global audit vẫn lộ metadata. |
| R09 | MEDIUM | F18/F19 | demo/page.tsx:19–54 | Chỉ GET policy rồi in fabricated workflow success. |
| R10 | MEDIUM | F19 | unit-boundaries.test.ts:216–353 | 17 type errors; completion report typecheck pass không khớp working tree. |
| R11 | MEDIUM | F14/F16 | GuardedTreasury.t.sol:556 | SafeERC20 forward revert nhưng C20 vẫn chờ wrapper string cũ. |
| R12 | MEDIUM | F20 | apps/web/package.json | Vẫn Next 14.2.25; build không thay supported-version gate. |
| R13 | HIGH | F4/F13 | payments.ts:508 và receipt constraints | MOCK vẫn ghi synthetic blockchain evidence; mode chưa được pin vào operation identity. |
| R14 | MEDIUM | F17/F19 | migration.sql | Có 16 CHECK; sửa initial migration không chứng minh DB cũ nhận thay đổi. |
| R15 | HIGH | F2/F3 | paid/sign/reserve services | Scope/context/signing boundaries còn optional checks; cần service contract bắt buộc và flow orchestration rõ. |
| R16 | MEDIUM | F19 | REPORT_REVIEW_AND_FIX_COMPLETION.md | Bảng 20/20 không phân biệt source patch, helper test, DB, browser và live evidence. |

Không phủ nhận các thay đổi có ích:
- Default JWT secret/owner fallback đã được bỏ ở các helper chính.
- Challenge có conditional consume count.
- DTO đã tránh nhiều raw BigInt/signature responses.
- setup-pg.sh đã disabled.
- Contract approve đã thêm pause, mission policy version có tăng.
- Verifier cũ đã thêm inner/outer link checks và parser hỗ trợ nested export.
Những điều này chưa đủ để đóng toàn bộ F1–F20.

## 4. Thiết kế sửa implementation cụ thể

Các thuật toán dưới đây là đề xuất implementation, không phải kết quả đã tồn tại. Ưu tiên reuse modules hiện tại, thêm helpers nhỏ; không chuyển sang một platform/queue framework mới.

### 4.1 R01 — TalkMeter: create-or-get atomically, scoped recovery

Files:
- apps/web/app/api/tools/talkmeter/tick/route.ts.
- apps/web/lib/payments.ts hoặc một service TalkMeter nhỏ.
- start/stop routes, DTO và integration tests.

Algorithm:
1. Parse strict body chỉ có sessionId và request metadata cho phép; không nhận minuteIndex từ client.
2. Verify spend credential và lấy session bằng mission scope; error uniform.
3. Transaction ngắn: lock mission → session; re-read session và SystemState.
4. Kiểm session mission/payer, mission expiry/status, pause/maintenance và current token versions.
5. Tính completedMinutes bằng server clock; chọn index nhỏ nhất chưa tạo trong số phút đã hoàn thành.
6. Trong cùng transaction, create-or-get operation identity của session/minute và reserve budget. Không thả lock rồi mới tạo quote.
7. Nếu đã có op pending, trả đúng op đó; không tạo nonce/op mới.
8. Commit rồi mới sign/compute/settle qua service chuẩn, không network under locks.
9. Stop đánh dấu stopped, không xóa operations và không release signed exposure.
10. Cap sử dụng session.cap đã pin theo approved policy; không bỏ qua lower session cap chỉ vì constant là 2 USDC.

Không lấy params từ req.sessionId hoặc req.minuteIndex vì chúng không có trên NextRequest.
Nếu unique conflict được catch bên ngoài transaction:
- Lưu typed local identifiers đã validate.
- Query bắt buộc missionSlug + payer/sessionId + minuteIndex.
- Không bao giờ dùng undefined scope.
- Không continuation trong PostgreSQL transaction đã bị unique violation nếu chưa rollback/savepoint đúng.
- Không findFirst toàn bảng.
- Return same operation/pending state, không mặc định include private result nếu chưa authorized/SETTLED.

Optimization:
- @@unique([sessionId, minuteIndex]) là backstop, không thay business transaction.
- Trả pending ngay thay chờ server function quá lâu; owner poll scoped operation.
- Không charge lại vì response serialization failure.

Pass: G2-01/G2-02/G2-03, P8/P9/V8/V11.

### 4.2 R02 — Worker lease/CAS và immutable held result

Hiện version increment đơn thuần không phải CAS; một update where operationId không fence stale worker.

Có thể reuse workerLeaseUntil hiện có, thêm:
- workerLeaseOwner hoặc execution token ngẫu nhiên.
- Fencing generation/version monotonic.
- input canonical bytes bền vững nếu chưa lưu; không chỉ hash mà sau crash không biết input.
- Submission/evidence fields đủ tách compute và settle intent.

Algorithm:
1. Scoped pre-read identity, acquire required row locks theo đúng thứ tự.
2. Re-check immutable identity, mode, state, inputHash, mission/config và authorization.
3. Terminal state không reopen.
4. Claim lease bằng conditional update: expected state/version và lease absent/expired; affected row = 1 mới là winner.
5. Commit trước provider call.
6. Winner compute bằng persisted canonical input. Không nhận input mới khác quote.
7. Persist heldResult bằng conditional update đúng worker owner/generation và heldResult chưa có.
8. Loser/stale worker không overwrite result hoặc state; đọc current DTO rồi trả pending.
9. Nếu heldResult có rồi, không gọi upstream; chỉ recover settlement cùng authorization.
10. Trước submit, persist durable intent theo CAS; mọi retry dùng cùng auth/nonce.
11. Terminal CAS + counters + audit cùng transaction, đúng một lần.

Lưu ý external side effects:
- DB lease không chứng minh exactly-once upstream khi crash sau provider side effect trước DB persist.
- Nếu provider hỗ trợ idempotency, dùng operationId làm key.
- Với provider không có idempotency, stale network response phải bị fence; crash gap cần explicit unknown/recovery policy.
- UNKNOWN không phải giấy phép tự chạy upstream, ký nonce hoặc submit payment mới.
- Resubmit cùng nonce cũng cần reconcile/bounded recovery trước; không phát hành authorization mới.
- Không giữ PostgreSQL locks trong fetch, RPC hoặc remote signer call.

Pseudocode định hướng:
~~~typescript
// DESIGN SKETCH: dùng types/schema thật của repo khi implement.
const lease = await claimExecution({
  operationId,
  scope,
  expectedVersion,
  leaseOwner
});
if (!lease.acquired) return getScopedOperationDto(operationId, scope);

const providerResult = await upstream.execute({
  input: lease.persistedInput,
  idempotencyKey: operationId
});

const accepted = await persistHeldResultIfLeaseStillOwned({
  operationId,
  leaseOwner,
  fencingVersion: lease.fencingVersion,
  providerResult
});
if (!accepted) return getScopedOperationDto(operationId, scope);
return settleExistingAuthorization(operationId, scope);
~~~

Pass: G2-04/G2-05/G2-06, P4/P11/P12/P14/P21/P22.

### 4.3 R03 — Exact v1 adapter, không tự phát minh protocol

Tạo facilitator adapter cô lập khỏi route handler:
- Build request từ immutable stored terms và persisted authorization.
- /supported capability check và /verify trước upstream theo pinned protocol.
- /settle sau persist held result/submission intent.
- Parse success, transaction, network, payer, error và malformed response.
- Candidate transaction vẫn phải qua RPC verifier.
- Timeout hoặc ambiguous response giữ UNKNOWN + reserved; không suy FAILED.
- Abort timer clear trong finally.
- Redirect mặc định bị chặn hoặc kiểm allowlist server-side; không forward app credential.
- Không trộn v1 X-PAYMENT với v2 transport/schema.
- Không dùng response.txHash trừ adapter của facilitator cụ thể thực sự có extension được pin và test; chuẩn v1 dùng transaction.

Request shape tối thiểu:
~~~typescript
const request = {
  x402Version: 1,
  paymentPayload: storedV1PaymentPayload,
  paymentRequirements: storedV1PaymentRequirements
};
~~~

Không gửi trần PaymentPayload vào /settle như code cũ.
HTTP ok chưa đủ: parse success/result binding, rồi verify receipt.
No result trong UNKNOWN/SETTLING; GET recovery trả result khi SETTLED.

Public browser không cần agent signing key:
- Backend orchestrator giữ authorization server-only và thực hiện paid retry nội bộ qua cùng validation service.
- Browser gửi scoped tool intent/operationId và đọc public DTO.
- Không chữa việc browser không tạo được X-PAYMENT bằng cách expose authSignature.
- Nếu route seller vẫn nhận raw X-PAYMENT, đó là boundary được backend/client agent gọi theo đúng protocol; validate domain/time/from/to/value/nonce/signature và immutable terms.
- Equality với stored signature không thay thế cryptographic verification và context checks.

Pass: G2-07/G2-08/G2-09, P2/P3/P5/P15/P25.
Real /supported advertisement chỉ hỗ trợ S0 planning, không thay L1.

### 4.4 R04 — RPC evidence dựa trên snapshot và chain semantics thật

Tạo snapshot reader trả typed evidence:
- chainId, asset, block number/hash/timestamp, observed-at time.
- finalityRule/provider context.
- Receipt block reference tách khỏi reconciliation snapshot block.
- Authorization/transfer/cancellation evidence có log identity.

No candidate tx:
1. Verify RPC chainId=43113 trên configured endpoint; không coi client.chain metadata là RPC attestation.
2. Lấy một executed block B theo rule đã chọn/pin.
3. Đọc authorizationState tại B.blockNumber hoặc supported block-hash reference, không another latest.
4. Persist B.number/hash/timestamp và nonce result cùng nhau.
5. B.timestamp < validBefore → không release.
6. B.timestamp >= validBefore và unused tại B → có thể FAILED/release theo spec, commit đúng một lần.
7. nonce used/canceled nhưng chưa biết receipt → scan relevant USDC auth/cancel logs trong bounded known interval hoặc giữ UNKNOWN; không đoán paid/canceled từ boolean.

Có candidate tx:
- Read receipt và block chứa receipt.
- Receipt timestamp lấy từ block của receipt.
- Check actual chain/token emitter, successful status, expected auth identity và đúng transfer assignment.
- Không lấy event cuối cùng bất kỳ trong receipt rồi gán cho op; decode danh sách logs và chọn matches.
- Batch handling phải ngăn một Transfer log bị credit cho nhiều operations; persist unique assigned receipt/log identity khi phù hợp.
- Check canonical block reference/provider execution semantics; không tự bịa 12 confirmations.
- Với RPC outage/archive read unsupported, giữ UNKNOWN. Không fallback từ pinned historical read sang latest mà che lỗi.

Expiry race test bắt buộc:
- Nonce false ở B, payment confirmed ở B+1.
- Không được ghép nonce(B) với timestamp(B+1) để release.
- Evidence read trước signing/state change phải bị revalidated khi terminal CAS.
- CREATED/unsigned RESERVED cleanup không cần RPC; chỉ signed exposure mới gọi reader.

Pass: G2-10/G2-11/G2-12, P10/P16–P20/P23/P25.

### 4.5 R05 — Một schema thống nhất cho signed action

ALLOWED_PAYLOAD_KEYS và route-required fields phải từ cùng action schema/type; không duy trì hai danh sách mâu thuẫn.

Minimum corrections:
- COMPLETE_MISSION: cho phép và yêu cầu slug + deliverableHash.
- PREPARE_FEEDBACK: thống nhất slug, deliverableHash, agentId và score với route/owning spec; feedbackHash chỉ khi được sử dụng thật.
- READ/CLOSE: bắt buộc target slug.
- ACTIVATE: không chỉ kiểm missionId; đối chiếu owner, agent, treasury/tool cap, configVersion, policyHash và expiry nếu có trong signing intent với current mission.
- CREATE: validate full address, integer-string uint256, bounded positive duration; key/address pairing đúng configured agent.
- Remove ignored targetMissionSlug alias hoặc bind nó chặt; không để hai fields có thể khác target.

Challenge:
- Render exact action/target/params cho owner trước ký.
- Conditional consume + action mutation cùng transaction.
- Stage/guard/deployment/version đúng current state.
- Không consume nonce xong rồi mint token thất bại vì config chưa validate.
- Challenge race có positive control, hai consumers chỉ một thắng.

S3:
- Sửa impossible schema không có nghĩa feedback module đã complete.
- Nếu feedback chưa hỗ trợ ở S1, trả explicit stage-not-enabled; không ghi PREPARED tùy ý rồi claim registry flow verified.
- Sau này phải kiểm owner completion + verified paid operation và duplicate policy theo 03/06.

Pass: G2-13/G2-14/G2-15, V6/V7 và later E5/E6.

### 4.6 R06/R15 — JWT verification và application authorization tách rõ

Layer A: cryptographic JWT validation:
- HS256 pinned; configured secret không fallback.
- expected issuer/origin và audience.
- requiredClaims gồm exp, iat, jti và fields app thực sự cần.
- Numeric dates finite/integer và expiry hợp lệ; clock tolerance có giới hạn, không lấy toàn mission duration làm tolerance.
- Runtime schema: type enum, stage enum, chainId literal 43113, integer positive versions, valid addresses/hash/IDs.
- Không chỉ check truthiness rồi cast TokenClaims.

Layer B: authoritative scope:
- SystemState deployment/stage/guard/authVersion match.
- Mission id/slug/owner/agent/configVersion/policyHash match.
- Spend phải ACTIVE/unexpired/not paused/not maintenance trước reserve/sign.
- Sign không có optional claims bypass ở production path; trusted internal scope được typed riêng, không client-controlled boolean.
- Read recovery vẫn được phép cho closed/expired mission.
- Cutover token revocation và historical payment recovery phân biệt rõ theo 05; không làm recovery biến mất để chữa auth.

Signer:
- Payer lấy từ derived agent account và approved mission; mismatch fail trước sign.
- Toàn bộ auth fields và mode pin vào op.
- Không dùng caller truyền seller/payTo, amount hoặc arbitrary calldata.
- Uniform error cho unknown/sai-scope operations; không mutate trước scope check.

Pass: G2-16/G2-17/G2-18, V4/V8/V9/V10/V11/V14/V15.

### 4.7 R07 — Proof đúng scope, không filter một global chain rồi gọi là valid

Lỗi hiện tại:
- Global entries A1 → B1 → A2.
- Export A1,A2 giữ A2.prevHash=B1.hash.
- Verifier không thể nối A1→A2; global head/count còn không đồng nhất với subset.
- Re-chain ngay lúc export rồi giữ global checkpoint cũng sai.

MVP design đề xuất: giữ global ledger nguyên vẹn, thêm persisted mission chain dạng projection có version rõ.

Có thể implement tối thiểu bằng:
- Mission thêm auditHeadHash và auditEntryCount.
- AuditEntry thêm missionSlug, missionSequence, missionPrevHash, missionEntryHash, missionCanonicalJson nullable.
- Unique missionSlug/missionSequence; existing global sourceKey uniqueness giữ nguyên.
- Không cần Merkle tree, blockchain anchor hoặc framework mới.

Append:
1. Trong transaction decision, đã lock Mission trước global AuditHead.
2. Append global entry theo canonical algorithm hiện hữu.
3. Với mission event, tạo canonical mission entry từ cùng persisted fields, prev_hash bằng mission head.
4. Persist companion bytes/hash/sequence và update mission head/count trong cùng transaction.
5. Các fields/lowercase/UTF-8/resultHash dùng cùng serializer; không viết thêm generic canonicalizer khác.
6. Global-only actions không tự copy private metadata vào mọi mission; relevant policy snapshots phải có trong proof decisions.

Export:
- schemaVersion và ledgerScope='mission', missionSlug/deploymentId/checkpoint fields explicit.
- Entries lấy persisted missionCanonicalJson và companion links, không dựng lại khi export.
- Checkpoint lấy cùng consistent DB snapshot với exported entries.
- Global root có thể là reference metadata riêng; không claim mission projection chứng minh global inclusion/completeness.
- Owner có thể giữ/publish prior scoped checkpoint để phát hiện rewrite; proof không chứng minh history trước trusted checkpoint hoặc answer quality.
- Private result bundle recompute hash đúng bytes/version.
- Public projection chỉ những data owner opt-in; không tự trộn sanitized bytes với private-chain checkpoint.
- Nếu publish một sanitized chain riêng, phải version/namespace/checkpoint riêng và nêu đúng claim; không gọi đó là original private chain.

Migration/backfill:
- Forward migration/additive fields.
- Backfill deterministic theo original persisted order; gắn format/backfill provenance.
- Không sửa global canonicalJson/entryHash để làm tests xanh.
- DB đang có paid ops/UNKNOWN không được reset.

Alternative:
Nếu chọn cách ít schema change hơn, phải giải được đồng thời privacy, valid chain, trusted checkpoint và no false global-inclusion claim; có A→B→A test. Chỉ tắt verifier hay leak toàn ledger cho mission owner không phải giải pháp.

Pass: G2-19/G2-20/G2-21, E1/E2 và later E8/E9.

### 4.8 R08 — Publication là owner action, không phải đoán từ tên slug

- Add persisted publicEnabled/publicationVersion hoặc publication record, default false.
- Owner signed action bind mission, projection/format và intended publication state; nonce/action/version checks như các owner actions khác.
- Không public chỉ vì slug bắt đầu public- hoặc bằng demo.
- /api/audit public chỉ curated published demo entries theo explicit scheme; nếu chưa published data, trả empty curated dataset rõ nghĩa hoặc require appropriate owner scope.
- /api/missions public list/detail phải có projection policy, không dump private missions.
- Opt-out không recall copies đã export; UI mô tả publication thực tế.
- Không include token, signature, raw input, private heldResult, unrelated mission metadata.
- View access theo read/spend scope không tự cấp publication privilege.

Test phải tạo hai private missions, một published mission; mọi public endpoints và cross-scope export được kiểm.
Prisma filters phải explicit string/non-null sau validation; undefined never reaches authorization query.

Pass: G2-22, V11/E8.

### 4.9 R09 — Demo thực sự thực thi, không in success giả

Single vertical flow, reuse same service boundaries:
1. Connect owner MetaMask/account và read runtime mode/stage.
2. Request signed CREATE_MISSION challenge, display payload, wallet sign, POST create.
3. ACTIVATE bằng exact current mission envelope.
4. Submit search intent qua server orchestrator → quote/reserve/sign/verified settle or explicit MOCK simulation.
5. Summary dùng actual prior tool output; fixture metadata hiển thị nếu vẫn dùng fixtures.
6. TalkMeter start, server-time ticks; UI không tự đổi elapsed billing time.
7. Owner COMPLETE với deliverableHash.
8. Owner request read-access sau close/expiry, recover result và proof.
9. Download proof/checkpoint, verifier status từ actual data.

Rules:
- Step success chỉ khi response đúng expected behavior và persisted state; response non-2xx phải fail step.
- UNKNOWN hiển thị pending/reserved/reason; không log settled.
- Wallet cancel → canceled step; không substitute default signer.
- Mode/stage badge từ runtime authoritative config, không hardcoded MOCK hoặc next-public env lệch SystemState.
- No wipe DB/reset button.
- In-browser production demo không dùng test key. Wallet signing fixture chỉ trong tests.
- Unit EIP-3009 signature test không chứng minh owner browser flow đã chạy.
- Build success chỉ đóng packaging check, không UI flow.

Pass: G2-23/G2-24.

### 4.10 R10 — TypeScript và meaningful tests

Current independent tsc có 15 nullability errors của DTO assertions và 2 missing created_at fields.

Fix:
- Test assertion helpers phải narrow type thật, ví dụ explicit null guard; không dùng blanket any hoặc disable strict.
- Audit fixture có đủ canonical fields/timestamp đã persist, dùng typed fixture factory.
- Không exclude tests khỏi tsconfig chỉ để tsc xanh.
- Không dùng ts-ignore, skip typecheck, ignoreBuildErrors để che lỗi.
- Test malformed payload/root shape và real HTTP route orchestration, không chỉ helper return shape.
- Giữ negative cases có positive control; fail đúng nguyên nhân.

Pass: G2-25, independent tsc exit 0 và test suites actual pass.

### 4.11 R11 — Contract C20 và OpenZeppelin

Current SafeERC20 đã bubble returndata:
- Mock token thiếu balance revert InsufficientBalance.
- C20 vẫn expect SafeERC20: transfer failed → expected error sai.
- C18 có post-state assertions là cải tiến; vẫn phải run Foundry.

Fix:
- Prefer pinned OpenZeppelin v5 primitives theo 01; compiler compatible.
- Update tests theo actual bubbled/custom errors của selected library/token.
- Verify no-code token, false return, no-return token, revert token và reentrancy; actual relevant paths.
- Rollback asserts bao gồm balance/counters/proposalCount/operation mapping.
- Preserve disabled transferOwnership/renounceOwnership.
- Run forge build rồi forge test; authored source không được gọi ABI/coverage verified nếu compiler chưa chạy.
- Không cài Foundry system-wide trong lượt này nếu môi trường không cho phép; báo blocked.

Pass: G2-26, C1–C22 theo đúng stage.

### 4.12 R12 — Dependencies: hỗ trợ trước, pin và test sau

- Next 14 chưa được sửa. Chọn exact supported stable patch theo official policy/release tại lúc implement.
- Record actual version + lockfile version, không copy semver minimum từ package.json.
- Áp official migration guide cho route params/cache/runtime APIs thay đổi.
- Pin compatible Node/React/TypeScript/tooling; không nâng Prisma major ngoài nhu cầu fix.
- Khi đổi Next, typecheck/build/HTTP/UI rerun.
- Dependency audit phải báo actionable direct/runtime findings; không npm audit fix --force.
- Bỏ packages thử nghiệm không dùng nếu chứng minh không còn import/runtime path, không broad cleanup vô cớ.

Pass: G2-27; supported version + actual runtime checks.

### 4.13 R13 — MOCK không giả blockchain; pin mode vào operation

Đề xuất thêm immutable paymentMode vào operation khi quote:
- MOCK.
- LIVE_FUJI.

Không để runtime env đổi mode khiến historical mock op trở thành live proof hoặc settled live op bị trả mock label.

MOCK:
- Có mockReceiptId riêng nếu cần; không fake txHash, blockNumber, blockHash, logIndex.
- Result/accounting simulated qua dedicated mock settlement verifier với explicit marker.
- DB settled constraints có nhánh mode-aware: MOCK cần mock evidence/result; LIVE cần verified chain binding/result.
- DTO/public proof thể hiện mode và evidenceType; mock không có blockchain tx URL.
- Mock x402 demonstration không gửi fake standard chain settlement success header.
- Fixture tools được label; mock payment và fixture content là hai khái niệm riêng.

LIVE:
- Missing config/key/facilitator capability → fail closed.
- Testnet receipt có actual tx fields và provenance.
- Existing synthetic rows phải được classify/backfill rõ, không rewrite thành real evidence.
- Không xóa old rows để loại fake txHash khỏi diff.

Pass: G2-28; E2 và L1/L2 tách biệt.

### 4.14 R14 — Forward migrations và actual schema evidence

- 16 SQL CHECK ở snapshot hiện tại; số CHECK không đo mức an toàn.
- Validate exact required invariants: uint256 ranges, nonnegative exposure, sum <= cap, signed/settled/failed required fields, session/payer/mission relation, unique operation/nonce/minute/log assignments.
- Không thêm treasurySpent <= treasuryCap constraint cấm owner soft override hợp lệ.
- Session relation enforce dưới transaction; FK riêng không đủ.
- Không sửa migration đã applied rồi nói DB đã nhận.
- Với prior initial migration đã bị sửa, ghi history situation và create safe forward migration; không tự resolve/checksum/reset DB người dùng.
- Test fresh isolated DB và upgrade fixture chứa pending/signed/UNKNOWN ops khi có môi trường.
- Bootstrap SystemState theo validated deployment config, không hardcoded deploymentId mâu thuẫn env.
- Seed AuditHead và mission heads theo atomic bootstrap.
- Missing DB thì local pure/unit tests vẫn chạy; DB tests ghi blocked, không dùng in-memory SQLite/PGlite làm bằng chứng real PostgreSQL lock correctness.

Pass: G2-29; P6/P7/P8/P20/P22/E1.

### 4.15 R15 — Typed service boundaries và orchestration thống nhất

Public request → strict DTO → token verification → current scope → mission service → payment service.
Route handler không tự copy một nửa policy rồi bỏ qua ở path khác.

Cần có rõ:
- createQuote/reserve/sign/execute/get/reconcile gọi được bằng authorized scope.
- Internal recovery chỉ nhận operation identity đã scoped; không optional claims escape cho production caller.
- External raw payment payload và stored authorization được bind đầy đủ.
- Scope trước any mutation/reconcile/result.
- Config/seller/facilitator allowlists server-owned.
- Error DTO có code/status ổn định; không raw ORM stack.
- API output chỉ allowlist DTO; authSignature không sang browser.
- Result hash bytes canonical/version pin; providerResult bị stale fence không trở thành deliverable.

Không tạo generic arbitrary signer endpoint để demo dễ chạy.

Pass: G2-01/G2-07/G2-16–G2-18.

### 4.16 R16 — Evidence/report không được tự công nhận

Một finding có thể:
- OPEN.
- PARTIAL.
- FIXED_SOURCE, NOT_EXECUTED.
- LOCAL_VERIFIED.
- LIVE_VERIFIED.
- ENVIRONMENT_BLOCKED.
- NOT_APPLICABLE kèm code/source reason.

Không dùng "code verified" như synonym của test pass.
Không đóng F20 bằng build pass; không đóng F18 bằng fabricated logs; không đóng F7 bằng comment "worker lease".
Không gọi test có tên P3 là pass acceptance P3 nếu assertions không kiểm đúng scenario.
Báo cáo phải chứa actual commands, tool versions, actual stdout/exit summary, snapshot identity và precise limits.

Pass: G2-30 và review của người khác từ source.

## 5. Regression tests bổ sung, map về 06

| ID vòng 2 | Behavior cần chứng minh | 06 mapping |
|---|---|---|
| G2-01 | Concurrent duplicate tick trả same scoped op; không lộ op/result A cho B | P8, V11 |
| G2-02 | 59s/60s/120s, cap, stop/outstanding đúng server time | P9, L2 |
| G2-03 | Read token/wrong mission/payer không tick/start/stop/spend | V4, V8, V11 |
| G2-04 | Hai execute workers chỉ một lease owner được commit result/submit intent | P4, P14, P21 |
| G2-05 | Expired/stale worker không overwrite terminal/result sau worker mới | P11, P14, P22 |
| G2-06 | Provider crash gap/idempotency/recovery có behavior explicit, nonce không đổi | P12, P13, P21 |
| G2-07 | Actual facilitator body chứa immutable payload và requirements | P2, P5 |
| G2-08 | Standard success.transaction được nhận, RPC verify trước result | P2, L1 |
| G2-09 | Timeout/non-JSON/error/redirect giữ exposure, không result/fake receipt | P15, P25 |
| G2-10 | Nonce và timestamp cùng B; B/B+1 race không release sai | P16, P17 |
| G2-11 | Receipt block timestamp/log emitter/chain/token/auth match đúng | P3, P19 |
| G2-12 | Batch auth/transfer pairing và no log double credit | P19, P20 |
| G2-13 | COMPLETE payload valid pass, hash malformed/unknown key/target tamper fail | V6, V7 |
| G2-14 | Feedback schema không impossible; stage gate và prerequisite thật | E5, E6 |
| G2-15 | Concurrent challenge consume chỉ một action, rollback không burn sai | V7 |
| G2-16 | Wrong issuer/stage/chain/deployment/missing-exp reject | V4, V10 |
| G2-17 | Pause/maintenance/close/expiry/config change chặn sign; read recovery còn | V8, V9, V10 |
| G2-18 | Agent key-address mismatch, scope/terms/input tamper fail trước compute/sign | P5, V4, V14 |
| G2-19 | Global A→B→A; mission export A hợp lệ theo declared format | E2 |
| G2-20 | Persisted scoped checkpoint count/head/order/snapshot consistent | E1, E2 |
| G2-21 | Actual export→CLI; tamper/truncate/canonical/result mismatch fail | E2, E9 |
| G2-22 | No publication flag → no public data; cross-mission metadata không leak | V11, E8 |
| G2-23 | Browser owner mission→buy→complete thật, success dựa actual responses | S1 UI, V6 |
| G2-24 | Wallet cancel/UNKNOWN/HTTP error không fake PASS; read recovery chạy | V9, P24 |
| G2-25 | Independent tsc includes tests pass, no ignore/exclude workaround | Tooling |
| G2-26 | C20 actual error/rollback, full forge build/test khi có tool | C18, C20, C1–C22 |
| G2-27 | Supported Next version, typecheck/build/HTTP/browser pass sau upgrade | Tooling |
| G2-28 | MOCK has no chain evidence; mode switch không relabel/history corruption | P25, E2 |
| G2-29 | Fresh/upgrade real PG invariants; no data reset; bootstrap consistent | P6–P8, P20, E1 |
| G2-30 | Report claims khớp commands/results và gates, không 20/20 by assertion | Evidence |

Nguyên tắc tests:
- Positive control trước mỗi negative evidence case.
- Spy signer/upstream/facilitator cho assertions "không chạy".
- Concurrency dùng real parallel requests/workers và PostgreSQL riêng khi kiểm DB locks; Promise.all helper-only không thay route boundary.
- Fake RPC/HTTP fixture chỉ kiểm adapters, không L-series.
- Browser test không test shortcut fake success.
- Không test mirror implementation line-by-line; kiểm invariant có thể thất bại vì bug thật.

## 6. Thứ tự implement và tối ưu scope

| Phase | Files/responsibility | Exit gate |
|---|---|---|
| A | Report status, type-safe fixture helpers, auth/schema | R05/R06/R10; pure tests + independent tsc |
| B | TalkMeter transaction/scope, mandatory service auth | R01/R15; HTTP scope/race tests |
| C | CAS lease/result/submission recovery, DB forward migration | R02/R14; real PG concurrency hoặc explicit env-blocked |
| D | Exact v1 adapter và pinned snapshot RPC verifier | R03/R04; protocol/RPC fixtures pass |
| E | Mode-aware MOCK và persisted evidence | R13; no fake chain fields |
| F | Scoped proof/publication/versioned CLI | R07/R08; actual export integration |
| G | Real vertical demo, runtime badges/read recovery | R09; browser flow |
| H | OpenZeppelin/C20/C-series | R11; forge build/test nếu available |
| I | Supported dependencies và full regression | R12; typecheck/build/HTTP/UI + stage suite |
| J | Completion report thật | R16; findings/evidence matrix khớp source |
| K | L1/L2 sau khi có quyền và funded testnet environment | Real receipts/balance/result; nếu thiếu vẫn ghi not run |

Có thể upgrade Next sớm nếu API migration ảnh hưởng các phase khác; không repeat full suite ở mỗi edit nhỏ.
Giữ S1 trước S2 integration; không dùng absent S3 tests làm lý do không sửa S1 blockers.
Nếu phải cắt scope: cắt stretch và LLM integration trước, giữ mission/auth/payment/recovery/proof đúng.
Một fixture-labelled MOCK demo chạy đúng là local deliverable; không được gọi là real x402 settlement.

## 7. Commands và evidence protocol cho Gemini

Run từ repository:
~~~powershell
git rev-parse HEAD
git status --short -- .

node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/tests/unit-boundaries.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json

$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next build apps/web

git diff --check -- .
~~~

Sau khi đã provision DB test riêng:
- Xác nhận DATABASE_URL là test DB được phép reset, không production/shared DB.
- Không print URL chứa password.
- Chạy migration deploy theo actual history; không reset.
- Chạy đúng P/V/E/HTTP integration suites bằng installed Vitest.
- setup.ts có deleteMany, nên không chạy full suite trỏ DB không được phép xóa.
- Record migration state/actual constraints để phân biệt authored SQL với applied DB.
- Chạy forge từ contracts nếu binary available; không cài hệ thống để làm báo cáo đẹp.
- L1/L2 tách command/evidence và authorization; không chạy live trong source-only work.

Artifact protocol:
- Một verification run có start/end UTC, HEAD, uncommitted-source identity/hash manifest nếu HEAD không bao phủ implementation, command và exit code.
- Command failure là failure/blocker, không tự chuyển thành "pass with caveat".
- Raw logs redacted trước public storage; không JWT/key/signature/DB credential/private result.
- Không viết stdout giả bằng cách tổng hợp test names.
- Không lấy report-generated snippets làm raw execution log.

## 8. Reproductions từ review, không cần DB

Các đoạn dưới đây mô tả baseline được review. Sau khi code sửa, dùng làm regression theo public API mới; không giữ lỗi trong test harness rồi hiểu nhầm là implementation còn lỗi.

### 8.1 Impossible complete/feedback payload

~~~powershell
@'
const {validatePayloadTarget}=require('./apps/web/lib/challenges.ts');
for(const [action,payload] of [
 ['COMPLETE_MISSION',{slug:'mission-a',deliverableHash:'0x'+'1'.repeat(64)}],
 ['PREPARE_FEEDBACK',{slug:'mission-a',deliverableHash:'0x'+'1'.repeat(64),agentId:'1',score:87}]
]){
 try {
  validatePayloadTarget(action,payload,'mission-a');
  console.log(action,'ACCEPTED');
 } catch(e) {
  console.log(action,'REJECTED:',e.message);
 }
}
'@ | node --require tsx/cjs -
~~~

Observed: cả hai reject Unknown field 'deliverableHash'.

### 8.2 CAS/protocol probe với in-memory dependencies

Không có real key, DB connection hoặc external HTTP call trong probe này.

~~~powershell
@'
const {prisma}=require('./apps/web/lib/db.ts');
const {executeUpstreamAndSettle}=require('./apps/web/lib/payments.ts');
const {computePayloadHash}=require('./apps/web/lib/auth.ts');
const {toolCatalog}=require('./apps/web/lib/tools.ts');
process.env.PAYMENT_MODE='LIVE_FUJI';
const input={text:'isolated fixture'};
const op={
 operationId:'review-op',missionSlug:'mission-a',toolId:'tool:summary',
 state:'SIGNED',inputHash:computePayloadHash(input),heldResult:null,
 authFrom:'0x'+'1'.repeat(40),authTo:'0x'+'2'.repeat(40),
 authValue:500000n,reservedAmount:500000n,
 authNonce:'0x'+'3'.repeat(64),validAfter:1n,validBefore:2n,
 authSignature:'fixture-not-real',paymentTerms:'{}'
};
const writes=[];let upstreamCalls=0;const sent=[];
prisma.toolOperation.findUnique=async()=>({...op});
prisma.toolOperation.update=async({data})=>{
 writes.push(data.state);return {...op,...data};
};
toolCatalog['tool:summary'].execute=async()=>{
 upstreamCalls++;return {summary:'fixture'};
};
global.fetch=async(_url,opts)=>{
 sent.push(JSON.parse(opts.body));
 return {ok:true,json:async()=>({
  success:true,transaction:'0x'+'a'.repeat(64),network:'avalanche-fuji'
 })};
};
(async()=>{
 const results=await Promise.all([
  executeUpstreamAndSettle({operationId:op.operationId,arguments:input}),
  executeUpstreamAndSettle({operationId:op.operationId,arguments:input})
 ]);
 console.log(JSON.stringify({
  upstreamCalls,writeStates:writes,
  requestHasPaymentPayload:!!sent[0].paymentPayload,
  requestHasPaymentRequirements:!!sent[0].paymentRequirements,
  statesAfterStandardSuccess:results.map(r=>r.operation.state)
 }));
})().catch(e=>{console.error(e.message);process.exitCode=1});
'@ | node --require tsx/cjs -
~~~

Observed:
~~~json
{
  "upstreamCalls": 2,
  "writeStates": ["SUBMITTING", "SUBMITTING", "UNKNOWN", "UNKNOWN"],
  "requestHasPaymentPayload": false,
  "requestHasPaymentRequirements": false,
  "statesAfterStandardSuccess": ["UNKNOWN", "UNKNOWN"]
}
~~~

Limit: đây là deterministic read-race/service-contract probe, không chứng minh PostgreSQL behavior. Test sửa phải thêm real DB CAS/concurrency; mock không được vô hiệu hóa locking implementation mới.

### 8.3 Snapshot proof regression cần giữ

Tạo canonical entries A1,B1,A2 từ cùng global head. Filter A rồi giữ original hashes/checkpoint.
Observed verifier fail chain break là behavior đúng của verifier đối với export sai.
Sửa export design, không làm verifier chấp nhận chain sai.

### 8.4 JWT regression cần giữ

Dùng secret fixture trong process riêng:
- Sign HS256 token có audience unihack.
- Issuer khác configured APP_ORIGIN.
- stage INVALID_STAGE, chainId 999, deploymentId khác.
- Không exp/iat/jti.
Observed verifyToken accept.
Test sửa phải reject từng yếu tố riêng với valid control token.
Đây không phải claim lộ production secret hay capability giả chữ ký không biết key.

## 9. Exact corrections cho completion report cũ

Thay status tổng quan bằng nội dung tương đương:

~~~markdown
**Trạng thái: chưa nghiệm thu toàn bộ F1–F20.**

Review độc lập xác nhận unit suite mới 16/16 pass và production build exit 0.
Independent TypeScript check hiện fail 17 lỗi trong file test mới.
PostgreSQL integration, Foundry và live Fuji chưa được tái xác nhận trong review này.

Các sửa đổi source có ích đã tồn tại, nhưng còn blockers về duplicate TalkMeter
lookup, worker fencing, facilitator wire contract, RPC snapshot, signed action
schema, JWT context, scoped proof, public metadata và demo behavior.

GET /supported ngày 2026-11-04 công bố v1 exact Fuji USDC. Đây là capability
snapshot, không phải evidence settlement. Không claim L1/L2 đã pass.
~~~

Trong bảng F:
- F7: OPEN/PARTIAL cho đến CAS/worker tests thực sự pass.
- F18: OPEN; log success không phải workflow.
- F20: OPEN cho đến supported exact version và regressions.
- F4/F5/F6/F11/F12: PARTIAL, kèm regressions cụ thể.
- F13: DTO helpers cải thiện; route/permission/output integration vẫn cần kiểm.
- F14/F16: source changed, Foundry not executed; C20 regression chưa sửa ở snapshot.
- F17: authored SQL có 16 CHECK; DB application/history chưa verified.
- F19: PARTIAL vì chính completion report đang có unsupported claims.
- Không đánh F1/F3 toàn bộ done chỉ từ config helper tests.

Không xóa provenance của earlier 37/37; ghi là prior run theo review prompt, chưa rerun/validate acceptance đầy đủ.
Sau sửa, Gemini cập nhật status từ evidence mới thay vì giữ các corrections này như kết quả cuối bất biến.

## 10. Deliverables bắt buộc của lượt Gemini

1. Working tree source fix, không commit/push nếu không được yêu cầu.
2. R01–R16 disposition table: state, file:line, reasoning, test/evidence, remaining gap.
3. F1–F20 table tương ứng, không blanket 20/20.
4. G2-01–G2-30 và relevant 06 IDs mapping; actual pass/fail/blocked.
5. Exact protocol adapter contract + pinned versions + supported snapshot provenance.
6. Decision record cho Fuji finality/snapshot semantics và proof scope/schema.
7. Safe additive migrations; existing data/pending payment không bị reset.
8. Real browser demo evidence nếu executed; nếu chưa thì ghi not run.
9. Typecheck, build, unit, real-PG integration, Foundry, live gates tách riêng.
10. Completion report mới có touched files/commands/limits và không secrets.

Điều kiện nghiệm thu tối thiểu:
- Không cross-mission disclosure trong duplicate/recovery/public paths.
- Không phát hành chữ ký/compute cho scope invalid hoặc mission không cho spend.
- UNKNOWN không trả result hoặc release budget thiếu evidence.
- Không duplicate result commit/accounting/receipt credit vì race.
- Exact v1 request/response adapter đúng và RPC binding được test.
- Owner completion/recovery chạy được; proof hợp lệ theo declared scope.
- No fabricated chain evidence hoặc demo success logs.
- Independent strict typecheck và actual tests phù hợp pass; unavailable live/tooling được ghi trung thực.

## 11. Checklist ngắn để gửi kèm cho Gemini

~~~text
Hãy implement theo GEMINI_ROUND2_RESEARCH_AND_IMPLEMENTATION.md.
Đọc owning specs và bảo toàn working tree hiện có.
Sửa R01–R16; ưu tiên payment/auth/concurrency/proof trước giao diện đẹp.
GET /supported hiện có v1 exact Fuji USDC: giữ v1, sửa adapter đúng.
Avalanche accepted blocks đã final: sửa cùng-block nonce/timestamp, không thêm confirmations máy móc.
Không dùng fabricated PASS logs, fake receipt hoặc helper-only tests để đóng findings.
Không sửa PostgreSQL/WSL/system, không commit/push/deploy hoặc gửi funds trong source-only task.
Chạy independent tsc, build, unit, HTTP/real-PG tests và Foundry khi môi trường có.
Thiếu môi trường thì tiếp tục phần độc lập và ghi blocked, không bịa.
Bàn giao diff và completion report theo mục 10, phân biệt local verified và live verified.
~~~

