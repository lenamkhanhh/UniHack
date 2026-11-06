# Review Vòng 8 — phần đã đạt và ba việc còn thiếu

Ngày: 2026-11-06, Asia/Saigon.
Repo: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: d247015ee855f7ef48297ea9f49c606346efa690.
Báo cáo: REPORT_REVIEW_AND_FIX_COMPLETION.md.
SHA-256 báo cáo: 2956671fc7a9cfc28011a3278375695e2465835f118b450cd85a674cc866bad2.

## 1. Verdict và bằng chứng

Chấp nhận tiến bộ source/build của vòng này:

| Check của reviewer | Kết quả |
|---|---|
| Next actual installed | 15.5.29; package exact và lockfile đã đổi |
| Production build | Exit 0; 23 dynamic API routes, 5 static pages |
| Typecheck sau build | Exit 0 |
| Unit/handler | 34/34 pass; 18.06s tổng, 5.99s test execution |
| Source manifest | 30/30 hashes khớp |
| Vitest list từ repo root | Exit 0; 71 dòng tên tests, không thu e2e |
| Vitest list từ apps/web | Exit 0; 71 dòng tên tests, không thu e2e |
| Playwright list | 8 cases / 3 files; 7 ui-mocked + 1 real-integration |
| 202 SUBMITTING/UNKNOWN UI branch | PENDING, không tiếp tục Complete |
| npm audit --omit=dev | npm exit 1; 0 critical, 1 high, 1 moderate |
| Chromium binary | executablePath không tồn tại |

Giữ acceptance M6 và các fixes handler đã đạt; không viết lại payment/audit.
71 tên test và 8 browser cases là discovery, không phải số tests đã thực thi.

Chưa chấp nhận toàn bộ R7-02/R7-04 hoàn tất:
còn nhánh HTTP 200 false success, pending browser fixture sai, và readiness của
UI-mocked vẫn gọi API cần DB. Không thực thi browser runtime, real PostgreSQL,
Foundry hoặc Fuji transactions trong lượt này.

Lượt tsc đầu chạy song song build gặp TS6053 vì build đang tái tạo .next/types.
Reviewer đã rerun sau build, pass. Đây là lỗi thứ tự kiểm tra của reviewer,
không ghi thành regression app. Build/tsc lần sau phải chạy tuần tự.

## 2. R7-01/F20 — nhận framework patch, giữ residual audit riêng

Next đã được nâng thực tế từ 15.1.12 lên 15.5.29.
[Support policy](https://nextjs.org/support-policy) hiện liệt kê major 15 Maintenance LTS.

Audit mới:

~~~json
{
  "critical": 0,
  "high": 1,
  "moderate": 1,
  "next": {
    "severity": "moderate",
    "via": ["postcss"],
    "fixAvailable": {"name":"next","version":"16.4.5","isSemVerMajor":true}
  },
  "postcss": {"severity":"high","isDirect":false}
}
~~~

Chấp nhận việc sửa direct Next advisory matches và major-support debt trong phạm vi
source/build đã kiểm. Không gọi project hết mọi vulnerability. Residual PostCSS
cần triage điều kiện áp dụng và bounded fix riêng; không tự nâng Next 16 hoặc
chạy audit fix --force chỉ để về 0.

Runtime regressions còn NOT_EXECUTED/BLOCKED theo gate. Không mở thêm upgrade lớn
khi chưa có bằng chứng cần thiết.

## 3. R8-01 — HIGH: HTTP 200 vẫn bị dùng thay cho SETTLED

apps/web/app/demo/page.tsx:330:

~~~typescript
if (opState === 'SETTLED' || tmTickRes.status === 200) {
~~~

202 UNKNOWN/SUBMITTING đã được sửa, nhưng OR phía sau vẫn nhận HTTP 200 làm
bằng chứng settlement dù operation RESERVED, SIGNED hoặc FAILED.

Actual tick route có thể trả 200 cùng existing non-settled operation:

- tick/route.ts:132–136: alreadyBilled trả existing operation.
- :176–180: default 200 cùng settlement.operation.
- :191–197: P2002 race recovery trả existing operation, không yêu cầu SETTLED.

Reviewer chạy nguyên decision branch hiện tại, không viết lại predicate:

~~~text
202 SUBMITTING -> PENDING
202 UNKNOWN   -> PENDING
200 RESERVED  -> SUCCESS
200 SIGNED    -> SUCCESS
200 FAILED    -> SUCCESS
200 SETTLED   -> SUCCESS
~~~

Đây là source branch probe, chưa mount browser; không kết luận accounting sai.

Cùng branch còn gọi /talkmeter/stop bằng fetch(...).catch(() => {}) mà không
kiểm response.ok/session.status. Inject stop HTTP 500 vẫn dẫn đến SUCCESS;
HTTP error không làm fetch reject. UI không được claim stopped cleanly như vậy.

Sửa targeted:

1. Payment success chỉ khi op.state === SETTLED, không dựa HTTP 200.
2. Nonterminal -> PENDING/recovery; FAILED -> ERROR; malformed body không SUCCESS.
3. alreadyBilled chỉ success khi existing operation thật sự settled.
4. Kiểm stop response trước claim stopped cleanly; giữ sessionId để retry khi lỗi.
5. Guard 400-before-60s verified là case riêng với phút đã thanh toán.

Regression bắt buộc cho phần này:

| Response | Kỳ vọng |
|---|---|
| 202 SUBMITTING/UNKNOWN | PENDING, không Complete |
| 200 RESERVED/SIGNED/SUBMITTING/UNKNOWN | PENDING, không Complete |
| 200 FAILED | ERROR, không Complete |
| 200 thiếu operation | Không SUCCESS |
| SETTLED + stop STOPPED | Success đúng scope |
| SETTLED + stop 500/network error | Không claim stopped cleanly |
| Premature 400 + stop fail | Guard có thể verified; stop failure phải visible |

Không đổi authorization/reservation lifecycle hoặc tự resign để sửa UI.

## 4. R8-02 — MEDIUM: pending browser cases chưa thể tới TalkMeter

apps/web/e2e/pending-and-publication.spec.ts:

- :61/:185 nhận chỉ { page }, không nhận wallet hoặc injectMockWallet,
  nhưng click Connect MetaMask. Wallet fixture hiện không auto-inject.
- :84–85/:208–209 mock challengeId/messageToSign.
- App demo :107 đọc challengeData.nonce.slice(...), :116 ký challengeData.message.
  Actual response contract là nonce/message.
- :108/:232 match activate bằng slug cố định test-pending-mission /
  test-unknown-mission; app :190 gọi bằng slug demo tạo động.

Vì vậy có browser binary vẫn chưa đảm bảo hai case đi tới tick/DOM assertion.
Discovery không kiểm các bước trên. Reviewer chưa chạy browser runtime nên đây
là finding source, không bịa kết quả browser FAIL.

Sửa:

1. Nhận { page, wallet }, inject trước goto giống mission-lifecycle spec.
2. Mock nonce/message/expiresAt theo API contract.
3. Lấy slug từ CREATE request hoặc match activate theo generated slug.
4. Intercept mọi API cần thiết cho UI-only cases, tránh request lọt ra DB thật.
5. Track tick request count > 0 và Complete request count = 0 ở pending case.
6. Assert PENDING bằng DOM sau khi tick thực sự được gọi.
7. Thêm matrix HTTP 200 của R8-01, ngoài hai cases 202 hiện có.

Case “Public and Private Proof Boundaries” :300–333 tự route.fulfill 401,
page.evaluate fetch, rồi assert response fixture. Nó chưa kiểm server access
control và chưa test “public proof strips results” như tên test. Đổi nhãn/phạm vi
hoặc kiểm API thật ở real integration khi có DB. Handler privacy coverage cũ
không bị mở lại chỉ vì browser case này chưa đúng.

## 5. R8-03 — MEDIUM: UI-mocked readiness vẫn phụ thuộc DB

playwright.config.ts đặt global webServer.url = TEST_BASE_URL + '/api/policy'.

Policy GET, apps/web/app/api/policy/route.ts:22, truy vấn Prisma SystemState.
DB unavailable dẫn tới catch :77–78 trả HTTP 500.
Runner chờ webServer trước khi page.route của browser tests được setup;
mock policy trong page không thay được readiness request của runner.

[Playwright webServer docs](https://playwright.dev/docs/test-webserver) yêu cầu
URL ready trả 2xx/3xx/400/401/402/403; HTTP 500 không phải ready.
Vì vậy UI-mocked startup vẫn có thể timeout do DB, trái README.

Sửa:

- Dùng readiness path không chạm DB như HTML /demo cho UI-mocked.
- DB readiness là check riêng của real-integration project.
- Không sửa policy API giả thành 200 để vượt readiness.
- Case UI render đầu tiên assert policy badges cũng cần mock initial policy.
- Giữ origin/port test cô lập, no reuse và server/baseURL nhất quán.

Đây là source/config work làm được trước khi có DB.
Browser binary missing và DB missing vẫn là hai prerequisites riêng.

## 6. Prompt cho Gemini

~~~text
Đọc GEMINI_ROUND8_REVIEW_AND_FIX.md.

Reviewer chấp nhận:
Next 15.5.29 actual + build/tsc pass; 34/34 unit/handler pass; manifest 30/30;
Vitest root/workspace discovery không thu e2e; Playwright discovery 8 cases;
202 UNKNOWN/SUBMITTING nay PENDING. Giữ M6 và các fixes đã đạt.

Chỉ sửa ba phần:
A. R8-01: bỏ status200 làm success. SETTLED mới payment success;
nonterminal pending, FAILED/error/malformed không Complete.
Check stop response trước claim stopped cleanly, giữ sessionId/retry khi stop fail.
Test 200 SIGNED/RESERVED/FAILED/malformed/stop500 và 202 cases.
B. R8-02: pending Playwright tests inject wallet, mock đúng nonce/message,
match generated activate slug. Spy tick>0, Complete=0 và assert DOM.
Test tự mock401 không được claim kiểm server privacy/public result stripping.
C. R8-03: readiness UI-mocked không gọi API phụ thuộc DB; DB readiness riêng;
mock initial policy cho UI-only render case.

Residual audit 0 critical, high PostCSS + moderate next-via-postcss cần triage riêng;
không audit fix --force hoặc tự nâng Next major để che report.

Sau source fixes, chạy ui-mocked khi browser binary có sẵn.
Real integration chỉ trên dedicated disposable DB, PAYMENT_MODE=MOCK rõ ràng;
không gọi đó là Fuji L1/L2 live. Thiếu môi trường giữ NOT_EXECUTED đúng gate.
Không sửa DB/WSL/trust/firewall, không commit/push/deploy/live tx ngoài nhiệm vụ.

Báo actual versions/source hashes/commands/exit/logs và phạm vi kiểm chứng.
Ưu tiên MVP chạy trọn luồng và demo pack; không thêm stretch features.
~~~

## 7. Probe source branch có thể tái chạy

Chạy ở repo root; không ghi source hoặc gọi real network.
Fake stop cố ý trả 500. Đây là source-fragment diagnostic, không thay browser test.

~~~powershell
node -e 'const fs=require("fs");const s=fs.readFileSync("apps/web/app/demo/page.tsx","utf8");const a=s.indexOf("      if (!tmTickRes.ok)");const b=s.indexOf("      // Step 7:",a);if(a<0||b<0)throw Error("FRAGMENT_NOT_FOUND");const f=new (Object.getPrototypeOf(async function(){}).constructor)("tmTickRes","addLog","setStatus","tmSession","spendToken","fetch",s.slice(a,b));(async()=>{for(const [httpStatus,state] of [[202,"SUBMITTING"],[202,"UNKNOWN"],[200,"RESERVED"],[200,"SIGNED"],[200,"FAILED"],[200,"SETTLED"]]){const statuses=[];const logs=[];await f(new Response(JSON.stringify({operation:{state,reservedAmount:"50000"}}),{status:httpStatus,headers:{"Content-Type":"application/json"}}),s=>logs.push(s),(step,status)=>statuses.push({step,status}),{session:{id:"probe-session"}},"probe-token",async()=>new Response(JSON.stringify({error:"stop failed"}),{status:500}));console.log(JSON.stringify({httpStatus,state,statuses,settledLog:logs.some(s=>s.includes("tick settled"))}));}})().catch(e=>{console.error(e);process.exitCode=1});'
~~~

## 8. Commands và files reviewer

Chỉ tạo GEMINI_ROUND8_REVIEW_AND_FIX.md. Không sửa application/test/config/package,
report gốc; không commit/push/deploy. Build/test tools có tạo cache/generated
artifacts thông thường. Không cài browser/dependencies hoặc start DB/dev server.

Lệnh chính thực thi tại repo root:

~~~powershell
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts tests/unit-boundaries.test.ts tests/handler-lifecycle.test.ts
node node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts --list
node node_modules/next/dist/bin/next build apps/web
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
git rev-parse HEAD
git status --short -- .
git diff --check -- .
~~~

Build set NEXT_TELEMETRY_DISABLED=1. tsc đầu race/build failed TS6053;
rerun tuần tự sau build exit0.

Read-only subprocess:
- npm.cmd audit --omit=dev --json: npm exit1, residual summary section2.
- node node_modules/vitest/vitest.mjs list --config apps/web/vitest.config.ts
  từ root: exit0.
- node ../../node_modules/vitest/vitest.mjs list --config vitest.config.ts
  từ apps/web: exit0.
- Node require package versions, Playwright executablePath/fs.existsSync.
- Decision probe section7: exit0, statuses section3.

Đọc Get-Content/Python scoped: report/package/config, E2E specs/README/fixture,
demo/policy/TalkMeter tick; hashlib kiểm 30 source hashes.
Một số batch output dài bị truncate, đã đọc lại source theo numbered ranges.
Scoped rg memory registry không có hit; không dùng memory.

Một tsx -e diagnostic thử policy mock không phát output, không dùng làm bằng chứng
handler runtime. Readiness finding dựa trên actual source + official docs.
Một số rg nhắm Playwright internal paths cũ không tồn tại, không dùng làm evidence.
Lần tạo MD đầu lỗi nội suy template ở tool script, chưa ghi file; đã sửa script tạo
tài liệu. Không có application source nào bị đổi trong quá trình này.

Sau khi ghi: kiểm UTF-8/fence pairs/whitespace, report và 30 source hashes unchanged,
git diff --check -- . .

