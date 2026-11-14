# Review Vòng 7: các fixes đã đạt và 4 việc cần hoàn thành

Ngày review: 2026-11-06, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: d247015ee855f7ef48297ea9f49c606346efa690.
Báo cáo: REPORT_REVIEW_AND_FIX_COMPLETION.md.
SHA-256 báo cáo: 13c610098a16110e6eeb3345176942abe411529e5022443f6f80d01e1984731e.

## 1. Kết luận

Vòng này có tiến bộ source thật:

- Next đã chuyển từ 14.2.25 sang bản cài thực tế 15.1.12.
- 12 dynamic API handlers đã chuyển sang await context.params.
- Handler lifecycle đã gọi thật TalkMeter start/tick/stop, retry và UNKNOWN.
- Hai probe đã có executable assertions.
- Playwright runner/config/fixture/spec đã tồn tại, discovery được 5 tests.
- Reviewer chạy độc lập 34/34 tests, tsc, hai probe và production build đều pass.
- Source manifest của báo cáo khớp 26/26 hashes.

Giữ acceptance giới hạn M6; không viết lại audit/payment lifecycle.
BH-02 và phần handler assertions của BH-03 có cải thiện thực sự.
Bốn việc dưới đây chưa cho phép kết luận toàn bộ browser/F20 đã hoàn tất.

Mục tiêu tiếp theo là một MVP thật chạy trọn luồng để quay demo/nộp bài.
Không cần mở thêm nhánh features hoặc tăng số lượng test chỉ để làm đẹp báo cáo.

## 2. Bằng chứng reviewer đã chạy

| Check | Kết quả | Phạm vi |
|---|---|---|
| TypeScript noEmit, incremental false | Exit 0 | Source/test typecheck |
| Unit boundaries + handler lifecycle | 34/34 pass, 16.57s tổng, 5.82s test execution | Node handlers/mocks + embedded SQL |
| Sec5 hardened probe | Exit 0, MIXED_BACKFILL_PASS | Actual helper + PGlite assertions |
| Sec6 hardened probe | Exit 0, 409 khi truncate, valid proof oracle pass | Actual GET + mocked tx |
| Next production build | Exit 0, Next 15.1.12, 23 dynamic API routes, 5 static pages | Build verification |
| Playwright --list | 5 tests / 2 files | Discovery, không launch browser |
| TalkMeter poison mutation | Expected test FAIL: REVIEW_POISON_START, caught=true | Test mới thực sự gọi start |
| Browser launch probe | Executable missing: chromium_headless_shell-1248 | Browser runtime chưa chạy |
| Vitest thu e2e folder | Exit 1, 2 failed suites | Xung đột runner được tái hiện |
| Actual demo TalkMeter branch probe | HTTP 202 UNKNOWN/SUBMITTING -> SUCCESS | Source decision branch, chưa mounted browser |
| npm audit --omit=dev --json | npm exit 1, next severity critical, fixAvailable=true | Dependency advisory matching, không exploit proof |

Mutation làm test fail là kết quả mong đợi; không phải regression ở source gốc.
Wrapper process cũng exit 1 vì Vitest ghi failure exit code; log xác nhận caught=true.

Không thực thi real PostgreSQL P/V/E suites, Foundry hoặc Fuji transactions.
Không có BROWSER_VERIFIED hoặc LIVE_VERIFIED mới trong review này.

## 3. R7-01 — HIGH: F20 chưa đóng vì cài bản Next quá cũ

Bằng chứng actual installed versions:

~~~text
next              15.1.12
react             18.3.1
react-dom         18.3.1
@playwright/test  1.64.1
vitest            2.1.9
~~~

apps/web/package.json khai báo next ^15.1.12; package-lock và node_modules
hiện vẫn resolve 15.1.12. Major 15 nằm trong Maintenance LTS không có nghĩa
mọi minor/patch cũ trong major đều đã nhận các security fixes mới nhất.

Read-only npm audit đã trả next severity critical, nhiều advisory matches;
ví dụ dải <=15.5.27 cho GHSA-p3m5-59mp-jv5r và >=13.4 <15.5.24 cho
GHSA-p293-qw3h-jr36. Không chạy npm audit fix.

Primary evidence:

- [Next support policy](https://nextjs.org/support-policy):
  major support và patch eligibility.
- [August 2026 security release](https://nextjs.org/blog/august-2026-security-release):
  patched releases 15.5.24/16.3.3 tại thời điểm release.
- [Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36):
  patch 15.5.24, điều kiện kết hợp Pages/App router trên Windows.
- [October App Router Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r):
  patch 15.5.28/16.4.1, có điều kiện dùng Server Actions.

Không kết luận app này đã bị khai thác hoặc chắc chắn thỏa mọi advisory condition.
Scoped rg không thấy use server trong app; advisory Server Actions có điều kiện
rõ ràng. Dù vậy 15.1.12 không đáp ứng yêu cầu chọn supported patched version hiện tại.

Sửa:

1. Kiểm latest patched stable 15.x tại lúc thực hiện; 15.5.28 là mốc vá của
   advisory tháng 10 vừa đối chiếu, không mặc định đó luôn là patch mới nhất.
2. Targeted upgrade package + lockfile, ghi version resolve thực tế.
3. Đọc peer requirements của đúng target trước khi đổi React/types.
   Next 15.1.12 local hiện khai báo peer React ^18.2.0 hoặc ^19; không tự suy
   React 18 hiện tại là lỗi chỉ từ major Next 15.
4. Chạy tsc/unit/build và read-only audit; phân loại direct/transitive/conditional.
5. Runtime regressions chưa chạy vẫn PARTIAL.

Status đúng: major migration/build VERIFIED; F20 patched dependency task OPEN.
Không dùng build pass làm bằng chứng bảo mật.

## 4. R7-02 — HIGH: demo đánh dấu TalkMeter SUCCESS khi chưa settle

File apps/web/app/demo/page.tsx:295–306:

- HTTP không ok: kiểm error.
- HTTP ok: log operation.state rồi setStatus('talkmeter', 'SUCCESS').
- HTTP 202 cũng có ok=true.

Reviewer lấy nguyên decision branch từ file hiện tại và chạy trong Node với
Response 202. Không sửa source và không mock lại chính decision logic:

~~~json
{"httpStatus":202,"operationState":"SUBMITTING","statuses":[{"step":"talkmeter","status":"SUCCESS"}]}
{"httpStatus":202,"operationState":"UNKNOWN","statuses":[{"step":"talkmeter","status":"SUCCESS"}]}
~~~

Đây là lỗi hiển thị có thể khiến demo tiếp tục complete trong khi phút còn pending.
Probe kiểm source branch, không phải browser run và không chứng minh settlement sai.

Sửa nhỏ, giữ đúng semantics:

- Payment success chỉ khi operation SETTLED và dữ liệu cần thiết đã có.
- Với pending/UNKNOWN, hiển thị trạng thái chờ hoặc recovery; chưa chuyển success
  và chưa tiếp tục complete như thể minute payment đã xong.
- Không tạo operation/signature mới chỉ vì poll/retry.
- Nhánh “tick quá sớm bị chặn” có thể là bài kiểm billing guard thành công,
  nhưng label/log phải nói guard verified, không nói phút đã trả tiền.
- Kiểm actual status sau response; không gộp mọi 2xx thành settled.
- Quản lý stop session trong luồng demo theo yêu cầu hiện có, không thêm
  auto-refill hoặc thay server-time billing để demo dễ chạy.

Regression thiết yếu: drive actual UI flow, trả 202 với SUBMITTING/UNKNOWN tại
TalkMeter tick, assert TalkMeter pill chưa SUCCESS và COMPLETE chưa được gọi.
Sau recovery SETTLED mới assert tiếp tục đúng. Test guard 400 là case riêng.

Không cần refactor toàn bộ demo. Có thể tách helper quyết định trạng thái nhỏ,
test helper và vẫn giữ browser DOM regression.

## 5. R7-03 — MEDIUM: Vitest thu nhầm Playwright specs

apps/web/vitest.config.ts hiện chưa giới hạn include/exclude để tách e2e.
Các files e2e/*.spec.ts khớp default Vitest test patterns.

Reviewer chạy có scope, không đụng DB:

~~~powershell
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/e2e
~~~

Kết quả exit 1, hai suites fail:

~~~text
Playwright Test did not expect test.describe() to be called here.
apps/web/e2e/mission-lifecycle.spec.ts:3
apps/web/e2e/pending-and-publication.spec.ts:3
~~~

Chỉ chạy hai test files bằng CLI như báo cáo sẽ che lỗi collection này.
npm test/vitest run không filter có thể gặp cùng lỗi, bên cạnh các DB gates khác.

Sửa:

- Vitest chỉ thu Node/unit/integration test files thuộc tests/.
- Playwright chỉ thu e2e/.
- Cấu hình root/include/exclude đúng khi chạy từ repo root lẫn apps/web workspace.
- Nếu override exclude, giữ các default exclusions phù hợp.
- Kiểm collection tách runner mà không chạy setup.ts lên DB chưa được xác nhận.

Acceptance: Vitest discovery không import Playwright specs; Playwright --list
vẫn thấy các browser cases. Chưa chạy DB suites thì ghi blocked riêng.

## 6. R7-04 — MEDIUM: harness mới có source nhưng chưa bao phủ real browser/data gate

Chấp nhận: runner/config/fixture/spec có thật, 5 tests discover được.
Chưa chấp nhận mô tả “chỉ cần có PostgreSQL là chạy đủ E2E”.

### A. Có blocker browser binary độc lập với DB

Direct chromium.launch probe báo:

~~~text
Executable doesn't exist at:
.../ms-playwright/chromium_headless_shell-1248/.../chrome-headless-shell.exe
~~~

Không cài browser/system tools trong lượt review này.
Phân biệt browser binary prerequisite và DB prerequisite.

### B. Phần lớn cases hiện là UI với mocked HTTP

mission-lifecycle.spec.ts:63–197 intercept policy/challenge/create/activate/
orchestrate/TalkMeter/complete/proof/audit.
Hai dashboard cases cũng mock /api/missions.

Những tests này hữu ích cho UI, và có thể chạy khi có browser + Next server
mà không cần PostgreSQL cho các APIs đã mock.
Không mô tả toàn bộ suite bị chặn duy nhất bởi DB.

Chưa có một spec full wallet -> actual HTTP -> real test DB -> response -> UI
không intercept core auth/mission/payment endpoints.
Có DB sẵn cũng không tự biến mocks thành real integration.

### C. Pending “DOM test” chưa assert DOM

pending-and-publication.spec.ts:61–86:

- Mock một API SUBMITTING.
- page.evaluate fetch API đó.
- Assert JSON nhận lại trùng fixture.

Không drive action khiến app render pending; không có locator assertion cho pending,
không có UNKNOWN case, không chứng minh UI không chuyển SUCCESS.
Vì vậy không phát hiện lỗi R7-02.

### D. Cấu hình shared server/base URL cần sửa trước full-flow run

playwright.config.ts:

- baseURL có thể đổi bằng env nhưng webServer vẫn cố định localhost:3000.
- reuseExistingServer = !CI có thể dùng nhầm server/DB deployment đang mở.
- NO_WEBSERVER chỉ kiểm truthiness, chuỗi "0" vẫn tắt server.
- trace on-first-retry nhưng retries=0 ở local: first local failure không có trace,
  khác README/report nói retain-on-failure.
- Selectors div:has-text(label) >> text=IDLE/SUCCESS có thể match nhiều ancestor;
  cần scope vào chính step card. Chưa xác nhận runtime selector failure.

Sửa tối thiểu:

1. Chia ui-mocked và integration projects/specs có nhãn rõ.
2. Thêm DOM case ở R7-02, public/private denial và proof download thực tế cần cho MVP.
3. Dùng port/origin test riêng; config server port/url/baseURL nhất quán;
   mặc định không reuse server không được xác minh.
4. Runtime DB project chỉ nhận dedicated disposable DB; xác nhận mode/deployment
   trước khi tạo/clear test data.
5. Dùng locator theo role/testid/step card, trace retain-on-failure phù hợp README.
6. Browser binary không có thì ghi NOT_EXECUTED; hoàn thành source/tests discovery
   độc lập, không thay môi trường thật bằng mock rồi gọi BROWSER_VERIFIED.

## 7. Đánh giá BH cũ và giới hạn

| Item | Review hiện tại |
|---|---|
| BH-01 phân biệt handler/browser, thêm runner | Source/discovery ACCEPTED; UI-mocked runtime chưa chạy, real integration spec còn thiếu |
| BH-02 gọi start/tick | ACCEPTED trong handler/mocked scope; mutation start bị bắt |
| BH-03 handler assertions | Có connect RPC, retry, UNKNOWN, real artifact hash, signed close/read, anonymous denial/public proof checks; handler test pass |
| BH-04 cleanup | Env và delegates đa số đã restore; systemState vẫn chỉ restore object có findUnique, chưa restore nguyên delegate; sửa nhỏ khi tách tests |
| BH-05/F20 | Migration/build pass; patched dependency gate vẫn OPEN |
| M6-01/M6-02 | Giữ acceptance cũ, probes hardened pass; không mở lại thiết kế audit |

Một điểm report cần đồng bộ: nói dùng vi.advanceTimersByTime nhưng actual handler
test đổi startedAt thành now-65000/125000. Fixture này vẫn kiểm elapsed calculation;
không gọi là bằng chứng đã kiểm server clock lifecycle đầy đủ.

Không tăng scope để làm thêm tính năng. Sau 4 việc chính, chuyển sang runtime MVP
và đóng gói README/demo/video/slides theo submission plan.

## 8. Prompt cho Gemini

~~~text
Đọc GEMINI_ROUND7_REVIEW_AND_IMPLEMENTATION.md.

Reviewer xác nhận:
- 34/34 unit/handler tests, tsc, production build Next 15.1.12 đều pass.
- Playwright discovery 5 cases; 26/26 manifest hashes khớp.
- Hai hardened probes pass; poison start làm handler test fail đúng mong đợi.
- Giữ M6 và các fixes handler đã đạt.

Lượt tới tập trung 4 việc, không thêm scope hoặc viết lại pipeline:

1. R7-01: chọn supported patched exact Next 15.x hiện hành.
   15.1.12 còn nhiều advisory matches; major 15 LTS không tự đóng F20.
   Pin/lock đúng target, kiểm peers, tsc/unit/build/audit.
   Không npm audit fix --force, không nâng mọi package major.
   Không tuyên bố app bị exploit chỉ vì npm audit severity.

2. R7-02: sửa demo TalkMeter: 202 UNKNOWN/SUBMITTING chưa được SUCCESS
   hoặc đi tiếp COMPLETE như đã thanh toán.
   Giữ billing guard-before-60s như case riêng, giữ payment lifecycle/idempotency.
   Thêm actual UI DOM regression cho pending -> recovery -> settled.
   Không fake settle, không thêm debug clock endpoint vào production.

3. R7-03: tách Vitest include/exclude khỏi Playwright e2e/*.spec.ts.
   Kiểm discovery từ repo root và apps/web; không chạy clearDatabase vào DB của owner.

4. R7-04: tách UI-mocked browser tests và real integration spec.
   Mocked suite không cần DB cho APIs đã intercept; cần browser binary + server.
   Real integration spec phải qua actual HTTP/DB, không route.fulfill core APIs.
   Sửa pending test thành DOM assertions thật, fix test server origin/port/reuse,
   trace/report docs và selectors.
   Thiếu browser/DB thì ghi từng prerequisite, không gộp thành thiếu DB.

Sau đó ưu tiên một S1 vertical flow chạy được để quay demo:
wallet -> mission -> paid tool -> result/receipt -> recovery/proof.
Không mở thêm stretch features. Không dùng test count thay độ bao phủ.

Báo actual commands/exit/logs/versions/source hashes.
Tách source/build/unit/mocked browser/real DB/browser/live.
Không commit/push/deploy, không live tx, không đổi DB/WSL/trust/firewall
hoặc reset dữ liệu owner ngoài nhiệm vụ được giao.
~~~

## 9. Reproduce lỗi UI pending bằng nguyên source branch

Chạy tại repo root, Node hỗ trợ Response.
Không ghi file source; chỉ chạy nhánh decision đúng trong file hiện tại.

~~~powershell
node -e 'const fs=require("fs");const s=fs.readFileSync("apps/web/app/demo/page.tsx","utf8");const a=s.indexOf("      if (!tmTickRes.ok)");const b=s.indexOf("      // Step 7:",a);if(a<0||b<0)throw Error("SOURCE_FRAGMENT_NOT_FOUND");const f=new (Object.getPrototypeOf(async function(){}).constructor)("tmTickRes","addLog","setStatus",s.slice(a,b));(async()=>{for(const state of ["SUBMITTING","UNKNOWN","SETTLED"]){const statuses=[];await f(new Response(JSON.stringify({operation:{state,reservedAmount:"50000"}}),{status:202,headers:{"Content-Type":"application/json"}}),()=>{},(step,status)=>statuses.push({step,status}));console.log(JSON.stringify({httpStatus:202,operationState:state,statuses}));}})().catch(e=>{console.error(e);process.exitCode=1});'
~~~

Sau fix, dùng browser regression hoặc helper test phù hợp; không giữ probe phụ thuộc
substring như kiến trúc test chính thức.

## 10. Commands và touched files của reviewer

Source edit duy nhất: tạo GEMINI_ROUND7_REVIEW_AND_IMPLEMENTATION.md.
Không sửa report gốc, application, contract, package hoặc test source.
Build/test tools có tạo/cập nhật artifacts/cache thông thường; không xóa artifacts cũ.
Không cài dependencies/browser, không start DB/dev server, không commit/push/deploy.

Executed commands tại repo root:

~~~powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/tests/unit-boundaries.test.ts apps/web/tests/handler-lifecycle.test.ts
node node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts --list
node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/test_sec5_probe.ts
node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/test_sec6_probe.ts
node node_modules/next/dist/bin/next build apps/web
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/e2e
git rev-parse HEAD
git status --short -- .
git diff --check -- .
~~~

Build set NEXT_TELEMETRY_DISABLED=1 trước khi chạy.
Hai tests source files pass; e2e-through-Vitest command fail như section 5.
Vitest CJS deprecation warning không phải failure.

Các probes khác:
- Node require package.json lấy actual versions/peers, Playwright executablePath + fs.existsSync.
- Direct chromium.launch headless: executable missing, không chạy browser tests.
- Read-only npm audit --omit=dev --json qua Python subprocess; npm exit 1;
  chỉ in next advisories/ranges, không apply fixes.
- TalkMeter source branch probe ở section 9: exit 0, tái hiện false SUCCESS.
- In-memory Vitest transform thay start/tick bằng functions throw:
  target handler-lifecycle.test.ts, expected failure REVIEW_POISON_START,
  ROUND7_POISON_EXPECTED_FAILURE caught=true, process exit 1.

Read-only inventory:
- Get-Content report hai phần, package/vitest/playwright config, specs, wallet fixture,
  e2e README, demo/page.tsx và dashboard.
- Scoped rg file/calls/assertions/installed Vitest declarations/lockfile version.
- Python JSON stores để đọc các đoạn handler/probes, 26 manifest hashes,
  report hash và source hashes dưới đây.
- Scoped rg memory registry không có UniHack/GuardedTreasury hit, không dùng memory.
- Một rg next.config.* wildcard không hợp lệ trên Windows; dùng rg --files
  xác định next.config.mjs. Không phải application error.
- Hai JSON source dumps quá dài bị tool truncate; chia nhỏ rồi đọc scoped,
  không dùng output bị truncate làm chứng cứ.

Primary web reads: Next support policy, security advisories/release được dẫn ở section 3.
Có đọc lại các security updates cũ để đối chiếu; không dựa vào advisory cũ
để kết luận patch hiện tại đầy đủ.

Extra source hashes:
- apps/web/vitest.config.ts:
  bd4a32e12219ace58ab7958c812c2f56cdee06dc67f541f666ff6e87edcd2b33
- apps/web/app/demo/page.tsx:
  1e019463ee15b3f0d4b906e571d5f2b4d12918e3bd6cc2059cb7713ff664be64
- package-lock.json:
  1536d6bf1ae9ee84fceeb9711354eb6a960f784e320bece55c98bc82c43da365

26 source hashes còn lại nằm trong báo cáo gốc, đã xác minh match.
Sau khi ghi MD: kiểm UTF-8/fences/whitespace, report/source hashes unchanged,
git diff --check -- . .

