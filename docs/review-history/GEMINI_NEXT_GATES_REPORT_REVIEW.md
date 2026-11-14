# Review báo cáo Vòng 6 và prompt hoàn thành các gate còn thiếu

Ngày kiểm tra: 2026-11-05, Asia/Saigon.
Workspace: D:\Code\Code\AIO\Code\ZaloAIC\UniHack.
HEAD: d247015ee855f7ef48297ea9f49c606346efa690.
Báo cáo được review: REPORT_REVIEW_AND_FIX_COMPLETION.md.
SHA-256 của báo cáo: 0f223cc88a2bfc96a8f0fc239326a96c3d5695e4909b3c7e3f1409b92a1e6c36.

## 1. Kết luận

Giữ acceptance giới hạn của M6-01/M6-02 trong GEMINI_ROUND6_VERIFICATION_AND_NEXT_GATES.md.
Cả 6 hash nguồn trong báo cáo hiện tại khớp snapshot đã được kiểm chứng ở lượt trước.
Lượt này không phát hiện thay đổi mới trong 6 file đó, không chạy lại unit/build/probes
và không nâng phạm vi acceptance lên toàn bộ S1.

Báo cáo mới đã sửa đúng cách mô tả Next 14 unsupported và tách các tầng bằng chứng.
Tuy nhiên đây vẫn là báo cáo các gate chưa chạy; chưa có kết quả mới chứng minh
DB_VERIFIED, BROWSER_VERIFIED, FOUNDRY_VERIFIED hoặc LIVE_VERIFIED.

Có các sai lệch trong hướng dẫn thực hiện tiếp, cần sửa trước khi đưa Gemini chạy.
Đây là lỗi trong báo cáo/handoff, không phải kết luận các lỗi M6 tái phát.

## 2. Bằng chứng kiểm tra ở lượt này

| Hạng mục | Quan sát hiện tại | Giới hạn |
|---|---|---|
| 6 file source manifest | 6/6 SHA-256 khớp báo cáo và snapshot M6 đã nhận | Không khẳng định mọi file ngoài manifest giữ nguyên |
| TCP 127.0.0.1:5432 | ECONNREFUSED | Chỉ kết luận endpoint này chưa dùng được |
| TCP 127.0.0.1:55432 | ECONNREFUSED | Không suy ra mọi DB/WSL/container đều không tồn tại |
| forge, psql, pg_isready | Không tìm thấy qua Get-Command trong PATH hiện tại | Không khẳng định không cài ở nơi khác |
| scripts/ | db-proxy.js, setup-pg.sh, verify-proof.ts | Không có hai file test_sec5_probe.ts và test_sec6_probe.ts báo cáo nêu |
| apps/web/package.json | Next 14.2.25, React ^18.3.1; chưa khai báo Playwright/Puppeteer | Thiếu harness là source work; chưa có browser run |
| contracts imports | Test import ../src/GuardedTreasury.sol; không import forge-std/OZ hiện tại | Không chứng minh contract đúng hoặc đã compile |
| git diff --check -- . | Exit 0 | Không kiểm thay đổi untracked như tracked diff |
| evidence/manifest.json | Có placeholder wallet roles; không có receipts L1/L2 | Không phải bằng chứng live |

33 tests, tsc, build, mixed-backfill probe và các proof cases đã được kiểm ở lượt trước.
Không đưa thời lượng ~3.20s của tác giả thành số đo reviewer mới trong lượt này.
Xem bằng chứng cũ trong GEMINI_ROUND6_VERIFICATION_AND_NEXT_GATES.md.

## 3. Những điểm cần sửa trong báo cáo

### RPT-01 — Cấu hình live đang chỉ sai base URL và payer

Bằng chứng:

- REPORT_REVIEW_AND_FIX_COMPLETION.md:298–300 yêu cầu nạp agent AVAX,
  nạp USDC vào OWNER_ADDRESS và đặt FACILITATOR_URL có hậu tố /supported.
- .env.example:10 đặt FACILITATOR_URL là base URL không có /supported.
- apps/web/lib/payments.ts:92 lấy payerAddress từ tokenClaims.agent.
- apps/web/lib/payments.ts:354–367 ký EIP-712 bằng AGENT_PRIVATE_KEY và
  đặt message.from = account.address.
- apps/web/lib/payments.ts:709 gọi fetch(baseUrl + '/settle').

Sửa hướng dẫn thành:

~~~text
FACILITATOR_URL=https://facilitator.ultravioletadao.xyz

GET {FACILITATOR_URL}/supported: kiểm capability, không phải settlement.
POST {FACILITATOR_URL}/settle: endpoint submission mà code hiện tại dùng.

Payer của tool payment là agent account được suy ra từ AGENT_PRIVATE_KEY,
phải khớp mission.agentAddress, operation.payerAddress và authorization.from.
Nạp Fuji USDC vào chính payer này trước L1/L2.
OWNER_ADDRESS là owner ký các hành động quản trị; không tự trở thành payer
chỉ vì owner cấp mission.

Khi facilitator gửi giao dịch settlement, gas do bên submit giao dịch chịu.
Không coi agent có AVAX là điều kiện bắt buộc cho riêng chữ ký authorization
gasless. Nếu chạy agent treasury tx/S2 hoặc deploy, xác định riêng ví gửi tx
và gas của luồng đó.
~~~

Nếu dùng /supported làm base URL, code hiện tại sẽ gọi /supported/settle.
Nếu chỉ nạp USDC cho owner, payer agent vẫn có thể thiếu số dư.
Không sửa code đổi payer sang owner để phù hợp với câu sai trong báo cáo.

Chuẩn ERC-3009 cho phép chuyển trách nhiệm trả gas sang bên khác;
việc ai submit phải đối chiếu với facilitator/flow thực tế.
Nguồn: [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009).
Các endpoint facilitator thuộc giao diện của
[x402 v1](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v1.md).
Khả năng hỗ trợ được quảng bá chưa chứng minh một giao dịch đã settle.

### RPT-02 — Gate C mô tả sai phạm vi C1–C22 và dependencies

REPORT_REVIEW_AND_FIX_COMPLETION.md phần Gate C gộp EIP-3009, toolCap và
TalkMeter vào C1–C22, đồng thời yêu cầu hai thư viện submodule chưa được code import.

Nguồn chuẩn là pipeline/06-tests-security.md:14–42.
C-series kiểm GuardedTreasury: propose/queue/approve/execute/reject,
hard policy, UTC daily/mission treasury cap, owner override, idempotency,
expiry, reentrancy và atomic rollback.

EIP-3009, reservation/toolCap và TalkMeter nằm trong payment/API/live gates.
Không tuyên bố Foundry pass chứng minh cả payment service.

Code contract hiện tại tự định nghĩa primitives và test helper.
Chưa có import forge-std hoặc openzeppelin-contracts trong hai file contract/test.
Vì vậy “phải tải đủ hai submodule” chưa phải prerequisite được chứng minh
cho snapshot này. Đọc actual imports/remappings trước khi cài dependency.

Nếu còn yêu cầu chuyển sang OpenZeppelin theo spec/review trước, ghi thành
source task riêng với dependency/version/lock provenance. Không coi việc
cài thư viện nhưng chưa dùng là đã hoàn thành yêu cầu đó.

Foundry gate thuộc S2. Không dùng C1–C22 để chặn acceptance riêng của S1.

### RPT-03 — Thiếu harness và thiếu bằng chứng tái chạy không chỉ là environment

Hai lệnh tại phần 4 của báo cáo trỏ tới:

~~~text
scripts/test_sec5_probe.ts
scripts/test_sec6_probe.ts
~~~

Hai file này hiện không nằm trong scripts/. Không thể xác minh nguyên trạng
hai lệnh đó bằng checkout hiện tại. Có thể từng tồn tại tạm thời; thiếu file
không chứng minh log bị bịa, nhưng cần sửa khả năng tái chạy.

Chọn một cách:

1. Dùng tests đã lưu trong apps/web/tests/unit-boundaries.test.ts làm regression
   chính; dẫn exact test name và command, bỏ lệnh trỏ file không được bàn giao.
2. Nếu cần probe riêng, lưu probe vào repo với imports hiện tại, fixture tối thiểu,
   không dùng secrets, rồi dẫn command và output đúng của probe đó.

Browser full flow bị chặn bởi runtime DB, nhưng tạo browser runner,
wallet test fixture, test cases và assertions là source work có thể làm trước.
Tách trạng thái:

- Harness chưa có: NOT_IMPLEMENTED / SOURCE_WORK.
- Có harness nhưng chưa chạy với DB runtime: NOT_EXECUTED / ENVIRONMENT_BLOCKED.
- Đã chạy browser + API + DB: ghi actual pass/fail và artifacts.

Wallet fixture dùng account test công khai trong harness cô lập, không dùng cho live
hoặc ví có tiền; không đưa fixture key vào production bundle.
Không gọi mocks-only browser flow là acceptance runtime PostgreSQL.

### RPT-04 — F20 đã mô tả đúng, nhưng source task vẫn chưa được thực hiện

Next 14.2.25 vẫn đang được khai báo; F20 OPEN là kết luận đúng.
Không biến việc sửa wording thành đã nâng cấp dependency.
Việc lập kế hoạch/migrate source có thể tiến hành trong phạm vi implementation
đã được giao; không cần chờ DB daemon chỉ để bắt đầu công việc này.

Nguồn mới kiểm tra:
[Next.js support policy](https://nextjs.org/support-policy)
liệt kê Next 16 Active, Next 15 Maintenance, Next 14 unsupported;
Next 15 được gia hạn security releases tới 2027-01-31.

Chọn supported stable exact patch tại thời điểm thực hiện và pin lockfile.
Với App Router, đối chiếu React/types và async request APIs theo
[Next 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15).
Next 15 có giai đoạn tương thích truy cập sync tạm thời; vẫn nên migrate async
đúng guide, không dùng UnsafeUnwrapped casts làm bằng chứng hoàn thành.

Typecheck/build/unit có thể chạy riêng; API/DB/browser regressions chưa chạy
thì F20 vẫn PARTIAL ở phần runtime. Không tự nâng mọi dependency major.
Next 15 có thời hạn support gần hơn Next 16, cần ghi tradeoff của lựa chọn.

## 4. Acceptance theo stage

Bám pipeline/06-tests-security.md, không tự đổi ID:

| Stage | Gates chuẩn |
|---|---|
| S1 | P1–P25; V3, V4, V6–V9, V11, V12, V14, V15; E1, E2; L1, L2 |
| S2 | S1 regressions liên quan; C1–C22; V1, V2, V5, V10, V13; E3; L3 |
| S3 | S1/S2 regressions liên quan; E4–E9; L4 |

E1/E2 ở đây là evidence/audit test IDs, không phải nhãn browser tests.
9 bước browser của handoff là danh sách acceptance UI bổ sung, không đổi E-series.

Trạng thái hiện tại: M6 focused acceptance giữ nguyên; toàn bộ S1 chưa đạt.
DB/browser/Foundry/live chưa có kết quả thực thi mới trong báo cáo này.
Không mở lại audit refactor chỉ để tạo thêm vòng sửa.

## 5. Prompt giao Gemini

~~~text
Đọc:
- GEMINI_NEXT_GATES_REPORT_REVIEW.md
- GEMINI_ROUND6_VERIFICATION_AND_NEXT_GATES.md
- pipeline/06-tests-security.md và pipeline/08-build-plan.md
- REPORT_REVIEW_AND_FIX_COMPLETION.md

Giữ scope sản phẩm, các fixes M6 và snapshot đã nhận.
Mục tiêu lượt tới: tạo implementation/evidence mới có thể tái chạy,
không chỉ viết lại báo cáo blocked.

1. Sửa RPT-01..04 trong báo cáo và runbook:
   base FACILITATOR_URL không chứa /supported;
   tool payer là agent ký EIP-3009 và giữ Fuji USDC;
   gas theo bên submit tx;
   C-series là GuardedTreasury/S2;
   thiếu browser harness là source work;
   bỏ lệnh probe không được bàn giao hoặc lưu probe thật.

2. Triển khai source task F20:
   kiểm official exact supported release, runtime/React/peer requirements;
   nâng targeted Next/React/types cần thiết và lockfile;
   migrate App Router params/request APIs và kiểm cache của routes auth/private;
   giữ Prisma/viem/jose major nếu không có lý do thực tế phải thay.
   Không dùng npm audit fix --force hoặc bỏ type errors để build pass.
   Chạy unit/tsc/build; ghi actual versions, commands và outputs.
   DB/browser regression chưa chạy phải ghi PARTIAL đúng phần.

3. Tạo browser harness trong source:
   runner config, isolated EIP-1193 wallet fixture, tests của 9 bước handoff,
   stable operationId, pending/UNKNOWN, TalkMeter, closed mission read recovery,
   proof verification và public/private boundaries.
   Trỏ runtime test server và DB test riêng bằng cấu hình rõ ràng.
   Có thể viết harness khi thiếu DB; không ghi BROWSER_VERIFIED trước khi chạy.
   Nếu flow thực tế phát hiện bug thì sửa targeted và thêm regression đúng bug.

4. Gate A chỉ chạy khi xác nhận dedicated disposable test DB:
   setup.ts có deleteMany, không trỏ shared/production database.
   Chạy migrations fresh và legacy upgrade, actual P/V/E applicable S1,
   HTTP integration, concurrent reserve/sign/recovery,
   backfill rollback và concurrent append.
   Ghi tên database được redacted hợp lý, versions, command/log và failures.
   Thiếu DB service/access thì ghi prerequisite; tiếp tục source tasks 2/3.
   Không sửa WSL/pg_hba/firewall/trust hoặc reset DB của owner.

5. Foundry khi có binary phù hợp:
   actual imports/remappings quyết định dependency;
   forge build và forge test -vvv, đối chiếu từng C1–C22.
   Không suy Foundry result sang TalkMeter/x402.
   Không deploy chỉ để kiểm unit, không tự cài system tools trong lượt này.

6. L1/L2 chỉ chạy trong phạm vi live đã được giao và có môi trường:
   kiểm /supported mới, pin x402 version/network/token;
   kiểm agent signer == mission agent == operation payer == authorization.from;
   balanceOf chính payer, không nhầm owner;
   L1 receipt + nonce + token + chain + seller delta + returned result;
   L2 hai phút = 0.10 USDC, hai receipts riêng, stop không thêm charge.
   Chưa có live run thì manifest là template, không evidence.
   Không in keys/tokens/signatures; không mainnet, approve(max), auto-refill.

Báo cáo cuối phải có:
- File đã đổi + SHA-256, exact versions và commands.
- Test IDs: implemented / executed / passed / failed / blocked riêng.
- Log paths hoặc raw outputs có thể tái chạy.
- Phân biệt số liệu reviewer cũ và thực thi của lượt mới.
- Gate blocked không được mô tả hoàn thành.
- Không commit/push/deploy hoặc ký/gửi transaction ngoài nhiệm vụ được giao.
~~~

## 6. Kiểm tra/lệnh trong lượt reviewer này

Chỉ tạo file Markdown này; không sửa app, contract, report gốc hoặc dependency.
Không commit/push/deploy, không chạy test có clearDatabase, không khởi động/chỉnh DB.

Các lệnh đọc/kiểm tra đã dùng tại repo:

- Get-Content -LiteralPath REPORT_REVIEW_AND_FIX_COMPLETION.md (đọc hai phần).
- git rev-parse HEAD; git status --short -- .; git diff --check -- .
- Get-Content apps/web/package.json, package.json, .env.example, contracts/foundry.toml.
- Get-Content GEMINI_ROUND6_VERIFICATION_AND_NEXT_GATES.md (phần next gates).
- rg --files giới hạn apps/web, contracts, scripts, evidence;
  tìm AGENTS.md và test/probe/browser files.
- Scoped rg đối chiếu C/P/V/E/L IDs và stage trong pipeline/06, pipeline/08;
  signer/payer/base URL trong payments.ts, config.ts, auth.ts và mission/tool routes;
  imports trong contracts/src và contracts/test; finality fields trong reconcile/manifest.
- Python pathlib/hashlib: đọc các đoạn nguồn liên quan, 6 source hashes,
  hash báo cáo/verification/manifest; liệt kê scripts.
- Get-Command forge, psql, pg_isready -ErrorAction SilentlyContinue.
- Node net.connect tới 127.0.0.1:5432 và :55432, timeout 1500ms, không ghi dữ liệu.
- Get-Item AGENTS.md, apps/AGENTS.md, apps/web/AGENTS.md: không thấy file ở các vị trí này.
- Một lần rg memory registry với UniHack/GuardedTreasury không có hit;
  không dùng memory làm chứng cứ dự án.

Chẩn đoán lệnh đọc: một Python dump bị lỗi console cp1252, đã đọc lại bằng JSON
ASCII-safe/UTF-8; một số rg nhắm env.ts/chainReader.ts không tồn tại,
đã xác định file thực tế config.ts/reconcile.ts. Không phải lỗi ứng dụng.
Một số inventory đầu ra dài bị truncate; các kết luận trên dựa trên reads scoped tiếp theo.

Web read-only: Next support policy, Next 15 upgrade guide, ERC-3009 và x402 v1.
Không gọi facilitator settlement hoặc sử dụng khóa ví.

Sau khi tạo tài liệu: kiểm UTF-8, fence pairs, whitespace của chính file và
git diff --check -- .; đây là document checks, không phải rerun application tests.

