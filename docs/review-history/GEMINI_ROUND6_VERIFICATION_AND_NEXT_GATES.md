# UniHack — Kết quả xác minh vòng 6 và handoff các gate tiếp theo

Ngày: 2026-11-05, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: main @ d247015ee855f7ef48297ea9f49c606346efa690.
Input: REPORT_REVIEW_AND_FIX_COMPLETION.md bản Vòng 6.

Lượt review này chỉ đọc source, chạy kiểm chứng và tạo tài liệu này.
Không sửa app/contracts/migration, không commit/push/deploy.

## 1. Verdict

**Chấp nhận đóng M6-01 và M6-02 trong phạm vi focused verification đã thực hiện.**

- M6-01: actual backfill helper xử lý được fixture mixed history với UNIQUE index thật trong PGlite.
- M6-02: actual proof handler giữ persisted checkpoint, phát hiện missing entries/head/sequence mismatch.
- Các positive controls vẫn pass; không phải implementation chặn tất cả requests để làm negative tests xanh.
- Không phát hiện blocker mới trong hai changes đang review.

Đây không phải nghiệm thu toàn bộ S1/production, không phải khẳng định toàn repo không còn bugs.
Chuyển từ vòng sửa audit lặp lại sang các gate thực tế còn thiếu.

## 2. Checks độc lập đã chạy

| Check | Reviewer result | Phạm vi |
|---|---|---|
| Unit/boundary suite | 33/33 PASS | Helpers, services/handlers với mocks, embedded SQL |
| Independent TypeScript | Exit 0 | apps/web, gồm tests |
| Production Next build | Exit 0 | Compile/package; có DB ECONNREFUSED khi page generation |
| Original M6-01 reviewer probe | MIXED_BACKFILL_PASS, projectedCount=2 | Actual helper + actual UNIQUE SQL trong PGlite |
| Eight direct proof cases | 8/8 PASS | Actual GET handler, transaction rows mocked |
| Source SHA-256 | 6/6 khớp report | Định danh working tree được review |
| git diff --check | Pass | Tracked diff whitespace; file untracked cần validate riêng |
| Real PostgreSQL concurrency | NOT_EXECUTED | Chưa có daemon evidence mới |
| Browser E2E | NOT_EXECUTED | Build không thay browser flow |
| Foundry / live Fuji | NOT_EXECUTED | Không compile contract, không gửi funds |

Production build có connect ECONNREFUSED 127.0.0.1:55432 lúc page generation.
Vì vậy build pass không chứng minh database-backed runtime đang hoạt động.

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

Ngoài ra: scoped source reads, report-manifest SHA-256 comparison, inline Node proof cases.
Original M6-01 script được lấy đúng từ section 5 của GEMINI_ROUND6_REVIEW_AND_FIX.md và chạy Node trong process riêng; không sửa script để bỏ UNIQUE constraint.

## 3. Direct proof cases đã kiểm

| Case | Expected | Actual |
|---|---|---|
| Fully projected valid chain | 200 + verifier valid | PASS |
| Missing tail | 409 checkpoint mismatch | PASS |
| Missing all entries, persisted count=2 | 409 checkpoint mismatch | PASS |
| Wrong persisted head | 409 checkpoint mismatch | PASS |
| Sequence gap | 409 sequence mismatch | PASS |
| Valid genesis count=0/head=zero | 200 + verifier valid | PASS |
| Pure legacy | 200, mission-legacy-derived + verifier valid | PASS |
| Mixed legacy/projected | 409 projection incomplete | PASS |

Các probes không dùng production key, không query user database, không submit facilitator hoặc chain transaction.

## 4. Hai fixes được xác nhận

### M6-01

Source: apps/web/lib/audit.ts:344–408.

- Validate source integrity trước writes.
- Clear existing sequence namespace trước final renumber.
- Assign deterministic sequence/hash theo source order.
- Giữ UNIQUE index.
- Update mission head/count sau projection.
- Original failure SQLSTATE 23505 không còn tái hiện với mixed fixture.

Limit còn lại:
- Atomic rollback, mission locking, concurrent append/backfill cần PostgreSQL daemon integration.
- Caller phải bảo đảm transaction/locks theo contract; một fake tx object không chứng minh guarantee đó.

### M6-02

Source: apps/web/app/api/missions/[slug]/proof/route.ts:131–193.

- Check sequence continuity.
- Check prev-link continuity.
- Compare exact entry count với mission.auditEntryCount.
- Compare computed last head với mission.auditHeadHash.
- Return persisted checkpoint sau validation.
- Pure legacy giữ namespace riêng; không áp uninitialized scoped checkpoint như authoritative root.

Positive/negative controls trong section 3 đều đạt.

## 5. Điều chỉnh nhỏ nhưng cần làm trong report

Báo cáo vẫn viết Next 14.2.25 "đang trong chu kỳ bảo trì upstream".
Official policy hiện liệt kê Next 14 là unsupported, 16 Active LTS và 15 Maintenance LTS.
Nguồn kiểm tra lại trong review: [Next.js support policy](https://nextjs.org/support-policy).

Sửa wording:
~~~markdown
Next.js 14.2.25: PARTIAL / OPEN.
Major version 14 hiện nằm ngoài các phiên bản được hỗ trợ theo official support policy.
Build/typecheck pass không đóng F20. Upgrade supported stable version hoặc ghi rõ
owner-approved scope decision; không mô tả 14 là Maintenance LTS.
~~~

Đây là open item đã có từ trước, không phải blocker mới của M6-01/M6-02.

## 6. Next gates — thứ tự làm cho Gemini

### Gate A: real PostgreSQL integration

Dùng database test riêng đã được provision hợp lệ.

- Kiểm tra setup.ts và các deleteMany trước khi trỏ DATABASE_URL; không chạy vào shared/production DB.
- Không print database credentials.
- Chạy actual P/V/E suites và HTTP integration flows.
- Kiểm fresh migration và upgrade từ legacy data.
- Kiểm two-phase backfill rollback và concurrency với append.
- Kiểm reserve/sign/expire/reconcile lock order và counters/audit exactly-once.
- Kiểm cross-mission access, challenge replay/concurrent consume, pause/version.
- Kiểm HTTP retry ở CREATED/RESERVED/SIGNED/UNKNOWN và settled result recovery.

Không thay PostgreSQL daemon bằng PGlite rồi gọi DB_VERIFIED.
PGlite vẫn hữu ích cho SQL/check constraints; giữ separate label EMBEDDED_SQL_VERIFIED.

Nếu thiếu service/credentials:
- Ghi ENVIRONMENT_BLOCKED với prerequisite cụ thể.
- Không sửa PostgreSQL/WSL config, không bật trust auth, không tự cài system packages.
- Tiếp tục các gate độc lập phù hợp.

### Gate B: browser + real API/data flow

Sau khi có runtime DB đúng:
1. Owner connect wallet và ký challenge.
2. Create/activate mission.
3. Stable operationId, search/summary flow qua server orchestrator.
4. UNKNOWN/pending không bị hiển thị success hoặc complete.
5. TalkMeter server-time minute boundary, successful minute và stop.
6. Owner complete với actual deliverable hash.
7. Close/expiry → new read credential → old paid result recovery.
8. Download proof và verify với checkpoint.
9. Public/private publication boundaries.

Browser tests dùng wallet mock trong test harness nếu cần.
Production UI không được có fixture owner key hoặc leaked agent signature.
Build thành công không thay BROWSER_VERIFIED.

### Gate C: Foundry

- forge build.
- forge test C1–C22.
- Record compiler/OpenZeppelin/tool versions và exact errors/rollback assertions.
- Không gọi contract source authored là tested.
- Không cài Foundry system-wide nếu không được phép.
- Không deploy contract chỉ để vượt qua unit-test gate.

### Gate D: supported dependencies

F20 vẫn open:
- Check official supported stable exact patch tại lúc implement.
- Apply migration guide, pin lockfile/runtime compatibility.
- Run tsc/build/unit/HTTP/browser regressions.
- Không nâng mọi package major vô cớ hoặc npm audit fix --force.
- Nếu chưa upgrade, báo OPEN; đây là source work, không environment blocker.

### Gate E: L1/L2 Fuji — chỉ khi có quyền và testnet environment

Separate live authorization/execution gate:
- Re-read facilitator /supported, pin actual version/network/token.
- L1: verified payment receipt, nonce/token/chain binding, seller balance, returned result/hash.
- L2: two completed minutes = 0.10 USDC, unique receipts; stop không thêm charge.
- Record finality/provider rule, snapshot references và redacted evidence.
- No mainnet funds, no approve(max), no automatic refill.
- Không ký authorization/submit transaction trong lượt chỉ kiểm chứng source nếu chưa được giao.

No live key/funds → NOT_EXECUTED/BLOCKED, không dùng mock receipt thay thế.

## 7. Prompt giao Gemini

~~~text
Đọc GEMINI_ROUND6_VERIFICATION_AND_NEXT_GATES.md.

Reviewer đã chấp nhận focused fixes M6-01/M6-02:
33 tests, tsc, build, original mixed-backfill probe và 8 proof cases đều pass.
Giữ các fixes; không viết lại audit pipeline hoặc mở thêm scope.

Bây giờ chuyển sang verification gates:
A. Real PostgreSQL integration/concurrency/migration/HTTP.
B. Browser wallet→mission→payment→recovery→proof flow.
C. Foundry build/tests khi tool có sẵn.
D. Supported Next dependency work, F20 vẫn OPEN.
E. L1/L2 Fuji chỉ khi được phép và có testnet environment.

Thiếu DB/tool/key thì báo prerequisite và blocked riêng, làm các phần độc lập.
Không sửa hệ thống PostgreSQL/WSL, không reset data/pending ops, không cài system tools,
không commit/push/deploy/send funds ngoài quyền được giao.

Chỉ sửa code khi gate thực tế phát hiện lỗi cụ thể; không thêm speculative refactor.
Báo actual commands/exit logs, touched files và source hashes.
Tách UNIT/HANDLER_WITH_MOCKS/EMBEDDED_SQL/REAL_DB/BROWSER/FOUNDRY/LIVE.
Sửa câu Next14 maintenance trong report theo official support policy.
Không suy toàn bộ S1 đã verified từ focused M6 acceptance.
~~~

## 8. Source manifest verified

| File | SHA-256 |
|---|---|
| apps/web/lib/audit.ts | e6b37028f1ca708534358fad1a465b8e384f46a8888427169a6f667af7743644 |
| apps/web/app/api/missions/[slug]/proof/route.ts | 707061b2bb476c62a07f10bbe4185cbacadca99d2430b81b92ef9d0e97f1ccb5 |
| apps/web/tests/unit-boundaries.test.ts | 134e3dc1da1b1471c8e158e9a1b26c6a7b68f6f50e25b9501c70f6736c8701c0 |
| apps/web/lib/payments.ts | 94c8beb1b2fe03477d2f895a43a6e4ecdf73aebd9e98ff91714fad7acf29dc9f |
| apps/web/app/api/tools/orchestrate/route.ts | 3070dcf572dc30883e034340f4c08defa30c81561fee5e5e90a9b572266928bb |
| apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql | 46348c72d9d99154263e2c3608d9b882cdab3533e44d9b321337cbbc7d058215 |

Nếu source hashes đổi, acceptance này chỉ áp dụng snapshot trên; dùng tests/gates để xác minh thay đổi mới.

