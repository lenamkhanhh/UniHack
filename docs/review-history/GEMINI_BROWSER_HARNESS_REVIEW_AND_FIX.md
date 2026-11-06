# Review browser workflow mới và prompt sửa đúng phạm vi

Ngày: 2026-11-05, Asia/Saigon.
Workspace: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: d247015ee855f7ef48297ea9f49c606346efa690.
Báo cáo được review: REPORT_REVIEW_AND_FIX_COMPLETION.md.
SHA-256 báo cáo: 4ff5ad33554dad844279d10196adbe9b3b43ffed4ebdb2f319276b4d4080fae3.

## 1. Verdict

Có tiến bộ thật: hai probe đã được bàn giao và tái chạy được; thêm một test
gọi nhiều production handlers trong cùng lifecycle với Prisma mock.

Reviewer đã chạy độc lập:

- TypeScript: exit 0.
- Unit boundaries + workflow mới: 34/34 pass, 2 files, tổng 16.61s;
  test execution 5.77s. Workflow mới 641ms.
- Probe M6-01: exit 0, MIXED_BACKFILL_PASS.
- Probe M6-02: exit 0, HTTP 409 AUDIT_CHECKPOINT_MISMATCH.
- Manifest báo cáo: 9/9 hashes khớp; 6 file M6 cũ giữ nguyên.
- Mutation check: thay start/tick bằng hàm luôn throw, workflow vẫn pass.

Giữ acceptance giới hạn của M6-01/M6-02. Không phát hiện bằng chứng hai lỗi này tái phát.

Chưa chấp nhận câu “hoàn thiện browser harness” hay “bao trọn 9 bước”.
Test mới là HANDLER_VERIFIED_WITH_MOCKS với phạm vi bên dưới.
Nó chưa có browser runner, chưa kiểm DOM và bỏ qua start/tick TalkMeter.
RPT-03 vì vậy PARTIAL. RPT-04 sửa wording đúng nhưng implementation F20 vẫn OPEN.

Không có kết quả DB/browser/Foundry/live mới được reviewer thực thi ở lượt này.
Không dùng 34/34 để suy ra toàn bộ S1 được nghiệm thu.

## 2. Findings có chứng cứ

### BH-01 — HIGH: handler test chưa thay thế browser harness

Bằng chứng:

- apps/web/vitest.config.ts: environment = node.
- apps/web/tests/browser-workflow.test.ts:3–15 import NextRequest và các route handlers.
- :284, :309, :354, :381 và các bước sau gọi trực tiếp handler bằng hàm.
- :259–260 thay $queryRaw bằng trả [] và $transaction bằng fn(prisma).
- Không có page.goto, click, DOM assertions, browser context hoặc runtime HTTP server.
- apps/web/package.json chưa khai báo Playwright/Puppeteer.
- Không thấy config/test browser E2E riêng trong apps/web khi scoped inventory.

Báo cáo có thừa nhận chưa BROWSER_VERIFIED; điều đó đúng.
Nhưng “browser harness source IMPLEMENTED” ở phần Gate B vẫn chưa đúng:
bật PostgreSQL/Next server không tự biến file này thành browser test.
Các mocks và direct imports vẫn bỏ qua runtime server sau khi DB có sẵn.

Sửa:

1. Giữ test này như handler lifecycle smoke và đổi tên mô tả cho đúng.
2. Tạo runner/config/spec/fixture trình duyệt thật riêng.
3. Tách harness source implemented, browser launched, real API/DB executed,
   actual UI assertions passed thành các trạng thái có bằng chứng.

[Playwright Test documentation](https://playwright.dev/docs/intro) mô tả runner,
browser binaries, config và browser projects. Chỉ thêm tên “browser” cho Vitest
Node test không đáp ứng browser E2E.

### BH-02 — HIGH: TalkMeter start/tick chưa được gọi

Bằng chứng trong apps/web/tests/browser-workflow.test.ts:

- :8–9 import postTalkmeterStart và postTalkmeterTick.
- :435–445 tạo startReq nhưng không truyền request đó cho postTalkmeterStart.
- :448–460 tự chèn session fixture vào inMemorySessions.
- :463–470 chỉ mock findUnique/update cho toolSession.
- :480 chỉ gọi postTalkmeterStop, rồi assert STOPPED.
- Không gọi postTalkmeterTick; không kiểm ranh giới phút, phí hay operation cho phút.

Vì vậy đoạn báo cáo nói “TalkMeter start/stop”, “minute boundary” và mô phỏng
tính phí theo phút vượt quá bằng chứng test hiện tại.

Reviewer đã kiểm bằng mutation transform trong bộ nhớ, không đổi file source:
thay hai imports start/tick bằng async functions luôn throw.
Workflow vẫn 1/1 pass:

~~~text
REVIEW_TALKMETER_POISON_RESULT {
  "transformed": true,
  "files": [{"name":"apps/web/tests/browser-workflow.test.ts","state":"pass"}],
  "failed": false
}
~~~

Đây là bằng chứng test không exercise start/tick; không phải kết luận hai handlers
production đang hỏng.

Regression cần bổ sung:

- Gọi production start và dùng sessionId trả về.
- Clock được kiểm soát trong test process để kiểm ngay trước/sau 60 giây;
  không thêm public endpoint thay đổi clock vào production.
- Gọi tick, assert minuteIndex, exact price 50000 atomic units, state/result.
- Retry cùng phút không tạo charge/operation thứ hai.
- Phút tiếp theo tạo operation khác, spent đúng 100000 sau hai settled minutes
  trong MOCK handler test. Không gọi đây là L2 live.
- Stop rồi kiểm tick tiếp theo không tăng spent/reserved/operations.
- Pending/UNKNOWN của phút chưa settle không được credit success.
- Với real DB test: thêm cạnh tranh tick/stop/cap theo acceptance hiện có.

Không dùng fixture set trực tiếp spent/status để thay kết quả của chính call đang kiểm.

### BH-03 — MEDIUM: các assertions còn hẹp hơn mô tả 9 bước

| Claim | Code thực sự đang kiểm | Còn thiếu |
|---|---|---|
| Wallet connect | Gọi ownerWallet.request(personal_sign) | Không gọi eth_requestAccounts trong test, không có UI connect |
| UNKNOWN/pending không hiển thị success | :393–429 seed SUBMITTING rồi gọi GET DTO | Không case UNKNOWN; không DOM hoặc trạng thái nút/log của UI |
| Stable operationId | :367–388 một call với ID cố định | Chưa retry cùng ID và chứng minh chỉ charge một lần trong flow này |
| Deliverable thực tế | :488 chuỗi 0x + d lặp 64 | Chưa hash artifact/kết quả thực tế; hiện chỉ kiểm lưu field |
| Closed/expired recovery | :526 gán status CLOSED trực tiếp, đọc bằng read token | Có coverage closed fixture; chưa exercise signed close route hoặc expiry |
| Public/private boundaries | :594–637 GET list trước/sau publish | Chưa anonymous private detail/proof/result denial và kiểm public DTO không leak |
| Proof export | :579–588 handler trả proof, gọi verifier | Có giá trị cho handler/proof; chưa browser download hoặc runtime HTTP flow |

Sửa báo cáo để không gộp missing cases thành đã pass.
Giữ các case hiện có; thêm assertions nhằm vào hành vi thật còn thiếu.
Không cần tạo thêm stage S3 chỉ để đóng các scope S1 ở đây.

### BH-04 — MEDIUM: mocks chưa có isolation đầy đủ

:149–151 chỉ lưu origFindUnique, origTx, origQueryRaw.
Sau đó thay các delegates systemState, authChallenge, mission, toolOperation,
auditHead, auditEntry và toolSession.
:638–642 chỉ khôi phục ba methods; các delegate còn lại vẫn là fake objects.
process.env được thay trong beforeEach nhưng chưa restore.

Hiện file chỉ có một test, nên suite pass không chứng minh lỗi cleanup đã xuất hiện.
Đây là rủi ro cụ thể khi bổ sung nhiều cases trong file hoặc thay chế độ isolation.

Ngoài ra mock updateMany :228–236 chỉ xét operationId:
không enforce các predicates state/version/lease của production.
$transaction không có rollback/locks; mission/update bỏ qua where.
Không dùng harness này làm bằng chứng về concurrency, CAS, rollback hoặc scope isolation.

Sửa targeted:

- Dùng vi.spyOn/vi.mock + afterEach restore đầy đủ, hoặc lưu/khôi phục nguyên
  delegates và env đã đổi bằng try/finally.
- Reset fixture riêng mỗi test; không chia sẻ trạng thái mission đã mutate.
- Chia workflow thành cases độc lập đủ xác định bước fail.
- Không xây Prisma emulator lớn để giả DB_VERIFIED.
- Để lock/CAS/concurrency/rollback acceptance ở real PostgreSQL tests.

### BH-05 — Existing OPEN: F20 chưa có source implementation

apps/web/package.json vẫn khai báo Next 14.2.25 và React ^18.3.1.
Phần kết luận báo cáo mô tả RPT-04 “khắc phục triệt để” chỉ đúng cho wording,
không đúng cho việc nâng dependency đã được yêu cầu ở handoff trước.

Đổi status:

- RPT-01: đã sửa đúng runbook base URL/payer/gas trong phần chi tiết.
- RPT-02: đã sửa đúng phạm vi C-series và actual imports.
- RPT-03: probe files delivered/reproduced; handler workflow PARTIAL;
  browser harness NOT_IMPLEMENTED.
- RPT-04: wording ACCEPTED; F20 implementation OPEN.

[Next support policy](https://nextjs.org/support-policy) hiện vẫn liệt kê
Next 14 unsupported, 16 Active và 15 Maintenance; Next 15 security support
được gia hạn tới 2027-01-31. Kiểm exact stable patch khi bắt đầu upgrade.
Không cần DB daemon để bắt đầu sửa package/async request API trong source.
Runtime regressions thiếu môi trường vẫn phải ghi PARTIAL.

Ghi chú nhỏ: summary live blocker vẫn nhắc thiếu AVAX cho payer agent, trong khi
runbook chi tiết đã nói đúng facilitator submit gasless. Đồng bộ summary với
runbook, không yêu cầu agent AVAX như điều kiện bắt buộc cho riêng x402 signing.

## 3. Hai probe: đã bàn giao, nhưng hiểu đúng exit code

scripts/test_sec5_probe.ts và scripts/test_sec6_probe.ts hiện đã tồn tại,
đã được reviewer chạy đúng command từ repo root và cho output đúng.

Cả hai hiện chủ yếu là diagnostic print, không có assertions đầy đủ:

- Sec5 log “PASS” sau helper return, chưa assert persisted sequence/head trong script.
- Sec6 log status nhưng không throw nếu status khác 409; exportValid được hardcode false.
  exportCount/head đọc từ body.entryCount/body.headHash, trong khi success proof
  nằm dưới body.audit.checkpoint.

Điều này không mở lại M6, vì unit tests và verification trước đã kiểm oracle.
Nếu coi probe là executable acceptance gate thì bổ sung assertions và exit 1 khi sai.
Nếu giữ diagnostic thì ghi rõ diagnostic, không xem exit 0 tự nó là oracle pass.

## 4. Implementation plan cho Gemini

### A. Sửa test scope và report trước

- Rename browser-workflow.test.ts thành handler-lifecycle.test.ts hoặc tên tương đương,
  cập nhật commands/hash trong report.
- Giữ 33 unit regressions và các fixes M6.
- Bổ sung TalkMeter và missing handler assertions ở BH-02/BH-03.
- Restore toàn bộ mocks/env; không sửa app chỉ để làm mock test pass.
- Thay deliverable fixture bằng hash của artifact bytes thực sự tạo trong test.
- Đổi trạng thái acceptance đúng bảng trên.

### B. Tạo browser harness riêng có thể chạy được

Đề xuất artifacts:

~~~text
apps/web/playwright.config.ts
apps/web/e2e/fixtures/wallet.ts
apps/web/e2e/mission-lifecycle.spec.ts
apps/web/e2e/pending-and-publication.spec.ts
apps/web/e2e/README.md
apps/web/package.json
package-lock.json
~~~

Đây là đường dẫn đề xuất cho lượt implementation, chưa được reviewer tạo.

Yêu cầu:

1. Pin runner version tương thích runtime hiện tại, cấu hình Chromium trước.
2. Config testDir riêng, baseURL test riêng, webServer phục vụ actual app.
   Không tái sử dụng server của owner một cách mù quáng; kiểm origin/port.
3. Inject EIP-1193 provider vào browser context; signer test chạy trong fixture
   cô lập, không bundle funded key hoặc agent secret vào production UI.
   Hỗ trợ methods/events mà UI thật dùng, kiểm signer/address/message.
4. Dùng page.goto('/demo'), click Connect và các controls thật; assert UI state.
5. Các calls để setup fixture có thể dùng page.request, nhưng ghi rõ
   API setup và UI assertions; không thay toàn bộ UI flow bằng direct imports.
6. Kiểm pending/UNKNOWN hiển thị đúng bằng DOM assertions.
   API interception có thể dùng cho UI-only state tests và phải gắn nhãn mocks.
7. Test wallet -> actual HTTP API -> test PostgreSQL -> response -> UI
   mới đóng full browser/data gate; không intercept backend thành fixtures ở gate này.
8. Nếu UI chưa có completion/close/proof download, ghi thiếu chức năng theo
   pipeline/05, rồi sửa đúng luồng cần thiết. Không đổi business policy để demo chạy.
9. Trace/screenshot khi fail, HTML hoặc JSON report, browser/runtime versions.
   Không đưa token/key/signature riêng tư vào artifact công khai.
10. Chưa có DB: có thể hoàn thành runner/config/spec source và test discovery;
    ghi NOT_EXECUTED/ENVIRONMENT_BLOCKED cho runtime flow. Không ghi 9 bước PASS.

Nguồn patterns đã áp dụng: e2e-testing skill (local) và official Playwright docs.
Không dùng arbitrary sleeps làm đồng bộ; chờ locator/response/state có nghĩa.

### C. F20 và real integration

F20 vẫn là source task trong scope full fixes/handoff đã giao, không phải việc
được đóng bằng phân tích lại. Target supported exact version + lockfile,
migrate affected App Router APIs, giữ business logic/caps/owner overrides.
Chạy typecheck/unit/build trước; DB/browser regressions sau khi có runtime.

Real DB:

- Xác nhận dedicated disposable database trước khi chạy setup.ts vì có deleteMany.
- Fresh + legacy migration, P1–P25 và V/E applicable S1 theo pipeline/06.
- Thêm backfill rollback/concurrency, atomic challenge consume, worker fencing.
- Không sửa PostgreSQL/WSL/trust/firewall hoặc reset dữ liệu của owner.
- Không thay DB daemon bằng in-memory adapter rồi gắn DB_VERIFIED.

Foundry/S2 và live L1/L2 giữ gates riêng. Không deploy/gửi transaction để bù cho
thiếu unit/browser evidence. Không commit/push trong lượt chưa được giao việc đó.

## 5. Prompt copy cho Gemini

~~~text
Đọc GEMINI_BROWSER_HARNESS_REVIEW_AND_FIX.md cùng handoff và acceptance matrix trước.

Reviewer đã thực thi 34/34 tests, tsc, hai probe đều pass; 9/9 hashes khớp.
Giữ acceptance giới hạn M6, không refactor lại audit pipeline.

Nhưng CHƯA chấp nhận browser harness hay đủ 9 bước:
- Vitest Node gọi trực tiếp handlers, Prisma mock, không browser/runtime HTTP.
- TalkMeter start/tick được import nhưng không gọi.
- Reviewer thay cả hai bằng hàm luôn throw mà test vẫn pass.
- UNKNOWN, minute billing, actual deliverable hash, UI state/download và
  anonymous private proof/result boundaries chưa được bao phủ như báo cáo claim.
- Mocks/env chưa restore đầy đủ.
- F20 vẫn Next 14.2.25; wording đã sửa không thay implementation.

Lượt này làm source/evidence thực tế:
1. Sửa BH-01..04 trong handler test; coverage assertions đúng nghiệp vụ.
2. Thêm Playwright runner/config/browser fixture/spec riêng có test discovery.
3. Làm targeted supported Next upgrade + lockfile/migration và regressions F20.
4. Chạy các phần độc lập, ghi output và hashes.
5. Real DB/browser runtime chỉ chạy trên dedicated test DB; thiếu env báo blocked
   cụ thể, không dùng để trì hoãn source tasks 1..3.
6. Hai probe đã delivered; nếu dùng làm gate, thêm assertions/exit 1 đúng oracle.
7. Sửa report: handler tests != browser harness, RPT-03 PARTIAL;
   RPT-04 wording accepted nhưng F20 OPEN tới khi source/checks đủ.

Không bịa thêm PASS, không coi test count là độ bao phủ.
Không thêm public clock/debug/reset endpoints để test tiện.
Không app refactor lớn, không đổi cap/UTC/owner override/authorization lifecycle.
Không commit/push/deploy/live tx hoặc sửa DB/WSL ngoài nhiệm vụ được giao.

Báo touched files, exact commands/exit, source versions/hashes,
implemented/executed/passed/failed/blocked theo từng gate.
~~~

## 6. Reproduction của mutation check

Chạy từ repo root. Vite transform chỉ thay nội dung module trong bộ nhớ của
test run; không ghi lại production source hoặc test file.

~~~powershell
@'
import { startVitest } from 'vitest/node';
let transformed = false;
const ctx = await startVitest('test', ['apps/web/tests/browser-workflow.test.ts'], {
  config: 'apps/web/vitest.config.ts', watch: false,
}, {
  plugins: [{
    name: 'review-poison-unused-talkmeter-calls', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/apps/web/tests/browser-workflow.test.ts')) return;
      const a = "import { POST as postTalkmeterStart } from '@/app/api/tools/talkmeter/start/route';";
      const b = "import { POST as postTalkmeterTick } from '@/app/api/tools/talkmeter/tick/route';";
      if (!code.includes(a) || !code.includes(b)) throw new Error('REVIEW_TRANSFORM_TARGET_MISSING');
      transformed = true;
      return {
        code: code
          .replace(a, "const postTalkmeterStart = async () => { throw new Error('REVIEW_POISON_START'); };")
          .replace(b, "const postTalkmeterTick = async () => { throw new Error('REVIEW_POISON_TICK'); };"),
        map: null
      };
    }
  }]
});
if (!ctx) throw new Error('REVIEW_NO_VITEST_CONTEXT');
try {
  const files = ctx.state.getFiles();
  const failed = files.some(f => f.result?.state !== 'pass') || ctx.state.getUnhandledErrors().length > 0;
  console.log('REVIEW_TALKMETER_POISON_RESULT', JSON.stringify({
    transformed, files: files.map(f => ({name:f.name,state:f.result?.state})), failed
  }));
  if (!transformed || failed || files.length !== 1) process.exitCode = 1;
} finally { await ctx.close(); }
'@ | node --input-type=module
~~~

Khi sửa test để start/tick được gọi, mutation này phải làm test FAIL do poisoned
function được gọi. Mutation không nhằm trở thành một production test dependency.

## 7. Source manifest

| File | SHA-256 |
|---|---|
| apps/web/tests/browser-workflow.test.ts | ec3b387fba01ac351a115178529c16a0439046a1bde79161c9fcfddbf5511009 |
| scripts/test_sec5_probe.ts | dd0ec5df62ab63e5904a23ea6c41b022e9cc9028ec1a80645c8c3676a895f249 |
| scripts/test_sec6_probe.ts | 553406d09800b1573753129d044fd70960a3de4690bf986587fed5038d9da288 |
| apps/web/package.json | a65b3617f3ca42566e29df7c5916c465404ce83a2fe349cdae3637e8b91d45c5 |
| apps/web/vitest.config.ts | bd4a32e12219ace58ab7958c812c2f56cdee06dc67f541f666ff6e87edcd2b33 |

6 file M6 cũ khớp manifest trong báo cáo; xem manifest và acceptance cũ tại
GEMINI_ROUND6_VERIFICATION_AND_NEXT_GATES.md.
Acceptance không tự chuyển sang snapshot sửa source sau này.

## 8. Commands và touched files của reviewer

Chỉ tạo GEMINI_BROWSER_HARNESS_REVIEW_AND_FIX.md.
Không sửa application/contract/tests/probes/report gốc/dependencies.
Không commit/push/deploy hoặc chạy full suites có clearDatabase.

Executed checks từ repo root:

~~~powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
node node_modules/vitest/vitest.mjs run --config apps/web/vitest.config.ts apps/web/tests/unit-boundaries.test.ts apps/web/tests/browser-workflow.test.ts
node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/test_sec5_probe.ts
node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/test_sec6_probe.ts
git diff --check -- .
~~~

Mỗi command trên exit 0. Vite CJS deprecation warning có xuất hiện, không phải
test failure. Không rerun production build vì 6 source files M6 chưa đổi;
lượt này không có build acceptance mới.

Mutation command đầy đủ ở section 6: exit 0, transformed=true, workflow vẫn pass.
Đây là finding coverage, không tính thành production test thứ 35.

Read-only commands:
- Get-Content báo cáo (hai phần), package.json, vitest.config.ts, demo/page.tsx,
  talkmeter/start và tick handlers, hai probe scripts.
- git rev-parse HEAD; git status --short -- .
- rg --files apps/web/tests/scripts và scoped browser/e2e config inventory;
  scoped rg các calls/assertions, report claims và installed Vitest node.d.ts.
- Python pathlib/json đọc 645 dòng workflow và hai probe; hashlib kiểm 9 source
  hashes + report và 5 file manifest ở section 7.
- Get-ChildItem AGENTS.md không thấy file tại UniHack root.
- Scoped rg memory registry không có UniHack/GuardedTreasury hit, không dùng memory.
- Read local e2e-testing SKILL.md và official Playwright/Next support pages.

Một inventory thử apps/web/components không có thư mục này; tiếp tục với app/.
Không phải application failure. Không chẩn đoán lại toàn máy/monorepo.

Document checks sau khi ghi: UTF-8, paired fences, no trailing whitespace,
source/report hashes unchanged và git diff --check -- . .

