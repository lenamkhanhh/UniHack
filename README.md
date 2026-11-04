# UniHack — Guarded Agent Economy

**Trạng thái: specification only.** Chưa có app/contracts được implement, chưa deploy, chưa có runtime test pass.
Research snapshot: 4 November 2026. Competition: [Avalanche Team1 Vietnam UniHack](https://team1vn.xyz/).

Một nhóm nghiên cứu/CLB giao agent mission có ngân sách. Agent mua search/summary tools bằng USDC Fuji,
người giao nhận deliverable và đối chiếu quyền chi, payment và result. TalkMeter minh họa billing theo phút.
S2 bổ sung treasury guard + human queue; S1 payment slice vẫn là release nộp độc lập.

## Bắt đầu cho Gemini

Đọc [handoff](pipeline/11-gemini-handoff.md), rồi [overview/constants](pipeline/00-overview.md).
Implement S0 → S1 → S2 → S3; giữ passing S1 release. Các checklist là yêu cầu phải chạy, không phải evidence đã pass.

| Spec | Nội dung |
|---|---|
| [00](pipeline/00-overview.md) | Use case, stages, constants, ownership của từng spec |
| [01](pipeline/01-contracts.md) | Treasury mission/queue, hard vs soft, idempotent propose |
| [02](pipeline/02-x402-tools.md) | Quote/reservation/authorization/receipt/recovery, TalkMeter |
| [03](pipeline/03-erc8004.md) | Deployed ABI, identity roles, owner quality feedback |
| [04](pipeline/04-agent.md) | Validator, canonical audit, result/proof export |
| [05](pipeline/05-app.md) | PostgreSQL schema/constraints, owner auth, spend/read, API/cutover |
| [06](pipeline/06-tests-security.md) | C/P/V/E/L acceptance matrix + threat model |
| [07](pipeline/07-demo-submission.md) | S1/full demo, 12-slide outline và submission |
| [08](pipeline/08-build-plan.md) | Execution order, release gates, freeze/fallback |
| [09](pipeline/09-breakthroughs.md) | Core evidence và optional simulation/replay |
| [10](pipeline/10-review-response.md) | Historical review responses; không override owning specs |
| [11](pipeline/11-gemini-handoff.md) | Handoff ngắn, invariants và remaining live checks |

## Competition và nguồn

- [Competition context](context/competition-context.md): lịch, eligibility, requirements, prizes và official-source conflicts.
- [20 optional ideas](context/idea-catalog.md), [source/Luma index](context/source-index.md).
- [Build references](context/build-sources.md), [spike checklist](context/spike-checklist.md).
- [Luma calendar](https://luma.com/Team1VN), [Builder Hub event](https://build.avax.network/events/596c0b2d-63aa-4cf0-a0ad-a7e34ddbfdc0).

Planning deadline 21 November 2026 23:59 Vietnam time; target submit 20/11, feature freeze 17/11.
Team1/Luma và Builder Hub khác deadline/venue/route trong research snapshot; xác nhận organizer instructions trước submit.
Public repo lược bỏ email cá nhân, member/applicant identities, invite tokens và liên hệ riêng.

## Giới hạn cần giữ trong demo

Hai budget riêng: treasury on-chain, tool budget off-chain khi signer/backend an toàn.
Key agent bị lộ có thể rút toàn bộ tool wallet; không auto-refill. Pause không recall authorization đã ký.
Mission hết hạn cấm spend mới nhưng owner vẫn read/reconcile/lấy kết quả đã trả tiền.
UTC day không rolling 24h; owner có soft-cap override và emergency withdraw.
Hash chain/checkpoint chứng minh consistency, không chất lượng câu trả lời/trustlessness.
Reputation không Sybil-proof. Mock/scripted/live luôn ghi đúng mode.

Không cần chạy install/forge từ README ở trạng thái này: chưa có implementation.
Khi implement, thêm lockfiles, env template rỗng, migrations, commands/results thật và receipt manifest đã sanitize.
