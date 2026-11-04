# 00 — Tổng quan sản phẩm và pipeline

**Đọc file này trước. Các file 01–09 là spec chi tiết cho cùng một sản phẩm, không phải 9 sản phẩm khác nhau.**

## 1. Sản phẩm trong 1 câu

**Guarded Agent Economy: agent có ví, nhưng không có quyền tiêu bừa.**

Trục use case chốt (xem 10-review-response.md §12): **một nhóm
nghiên cứu / CLB giao agent một nhiệm vụ có ngân sách; agent mua
công cụ để hoàn thành nhiệm vụ đó; mọi khoản chi đối chiếu được
với quyền được cấp và kết quả nhận lại.** Mission là đơn vị trung
tâm của sản phẩm, không phải một field cap phụ.

Agent chỉ được *đề xuất* chi tiêu trong một mission đã được owner
giao và kích hoạt. Một hợp đồng guard trên Fuji kiểm tra chính sách
bằng code, không bằng lời hứa. Đúng chính sách thì tự chạy, sai
chính sách thì xếp hàng chờ người duyệt, tấn công thì bị chặn và
ghi lại. Tool thì agent mua bằng x402, trả đúng số tiền, đúng người,
đúng lần — không approve vô hạn.

## 2. Vấn đề — giải pháp — bằng chứng (pitch 30 giây)

- Vấn đề: agent tự trị mà cầm ví nóng thì một prompt injection, một
  địa chỉ giả mạo, hay một approve vô hạn là đủ rút sạch quỹ.
- Giải pháp: tách 3 quyền ra khỏi nhau — agent **đề xuất**, guard
  **quyết định**, con người **duyệt ngoại lệ**. Tiền quỹ nằm ở guard,
  không nằm ở ví agent.
- Bằng chứng (không phải slide): demo live trên Fuji với tx hash thật,
  một test tấn công có đối chứng (ví nóng naive bị rút, guard thì
  0 chuyển tới attacker trong các kịch bản đã chạy — xem giới hạn ở §10),
  và một audit ledger mà giám khảo tự kiểm tra được.

## 3. Pipeline tổng thể — 6 tầng, đi theo thứ tự này

```
Người dùng / Giám khảo
        │
        ▼
[1] App (Next.js) — dashboard, queue duyệt, audit ledger, demo script
        │  đọc on-chain qua viem, ghi off-chain qua API
        ▼
[2] Agent proposer — LLM chỉ trả JSON proposal, không bao giờ tự ký chi
        │  tiền quỹ. Xem 04-agent.md.
        ▼
[3] Pre-flight validator — code thuần, kiểm tra BLOCK/QUEUE trước mọi lần ký.
        │  LLM có bị lừa cũng không qua được tầng này. Xem 04-agent.md §3.
        ▼
[4] Hai đường tiền, tách bạch, không lẫn nhau
        ├─ A. Treasury payout: GuardedTreasury (on-chain, Fuji) — 01-contracts.md
        └─ B. Tool purchase: x402 exact + facilitator (off-chain ký, on-chain
           settle) — 02-x402-tools.md
        ▼
[5] Trust layer — ERC-8004 Identity + Reputation (Fuji, canonical) — 03-erc8004.md
        │  identity để biết agent là ai, reputation để biết nó đã làm tốt
        │  bao nhiêu lần. Reputation KHÔNG phải bằng chứng chống Sybil.
        ▼
[6] Evidence — tx hash Snowtrace + hash-chained audit ledger + video
        │  2:30 + slides. Xem 07-demo-submission.md.
```

**Nguyên tắc xuyên suốt:**

1. **Propose ≠ execute.** Không có đường nào từ output của LLM đi thẳng
   tới tiền mà không qua validator hoặc guard.
2. **On-chain là sự thật, off-chain là bản giải thích.** Mọi quyết định
   quan trọng đều có event/tx hash; UI chỉ hiển thị lại.
3. **Fail closed.** Không chắc thì chặn / xếp hàng, không tự chạy.
4. **Testnet only.** Fuji, USDC testnet, không mainnet, không key thật.
5. **Mock phải ghi là mock.** Chế độ rehearsal không bao giờ được trình
   bày như live Fuji.

## 4. Kiến trúc (đọc kèm 05-app.md)

```
┌──────────────────────────── App (Next.js, 05-app.md) ────────────────────────────┐
│ Dashboard │ Proposal form │ Human queue (approve/reject) │ Audit ledger │ Demo mode │
└──────┬──────────────────────┬───────────────────────┬──────────────────────┬───────┘
       │ API /api/propose     │ API /api/queue        │ API /api/audit     │ scripted
       ▼                      ▼                       ▼                    ▼
┌────────────────────── Agent service (04-agent.md) ──────────────────────────────┐
│ LLM proposer (JSON only) → schema validate → pre-flight BLOCK/QUEUE → route:       │
│   AUTO (in-policy) → guard.execute / x402 sign │ QUEUE → pending │ BLOCK        │
└──────┬──────────────────────────────────────────────────────────────────────────┘
       │                                    │
       ▼                                    ▼
┌─ Fuji (43113) ──────────────────┐   ┌─ x402 facilitator ───────────────────┐
│ GuardedTreasury (01)            │   │ Ultravioleta hosted (thử trước)      │
│  USDC 0x5425…Bc65 (6 decimals)  │   │ fallback: Thirdweb, rồi x402-rs tự   │
│  ERC-8004 Identity 0x8004A818…  │   │ host. Verify + settle qua facilitator│
│  ERC-8004 Reputation 0x8004B663…│   │ 402 → EIP-3009 sign → 200 + tx hash   │
└─────────────────────────────────┘   └──────────────────────────────────────┘
```

## 5. Hai đường tiền — đừng gộp

| | A. Treasury payout (quỹ nhóm) | B. Tool purchase (mua tool) |
|---|---|---|
| Tiền nằm ở | Guard contract | Ví agent (chỉ giữ tiền lẻ tool, ví dụ $5 test) |
| Ai ký chi | Guard contract, sau khi check policy | Agent ký EIP-3009, facilitator settle |
| Giới hạn | per-tx cap, daily cap, allowlist, mission **treasury** cap | per-call cap, session cap, tool allowlist, mission **tool** cap |
| Sai policy | Vào pending queue, chờ người duyệt | Không ký, trả lỗi + ghi audit — **không có human queue cho tool trong MVP** |
| Bằng chứng | Event + tx hash trên Fuji | `X-PAYMENT-RESPONSE` + tx hash Snowtrace |

**Hai budget riêng, không gộp (quyết định chốt, xem 10 §1):** một
mission có treasury cap (10 USDC, enforce on-chain) và tool cap
(5 USDC, enforce off-chain bởi validator + reservation). UI phải
hiển thị spent/reserved/remaining/expiry cho từng budget riêng.
Không cộng hai budget thành một con số "mission spent" mơ hồ, và
không ghép x402 vào guard contract.

**Câu cấm nói sai:** guard KHÔNG kiểm soát settlement của x402, trừ khi
code thực sự làm vậy. Trong MVP, guard kiểm soát payout quỹ; pre-flight
kiểm soát tool payment trước khi ký. Hai lớp khác nhau, nói đúng tên.

## 6. Pipeline theo giai đoạn — Gemini làm theo thứ tự này, không làm ngược

Đây là điểm mấu chốt để pipeline không sập vì làm lan man. Mỗi stage
xong mới sang stage sau; stage trước là fallback submittable của stage sau.

| Stage | Làm gì | Xong khi | Nếu kẹt |
|---|---|---|---|
| **S0 — Spike (đã có checklist)** | Fuji + facilitator + ERC-8004 đọc/ghi | 402 → pay → 200 có tx hash thật; guard deploy được | Xem `context/spike-checklist.md`, đổi facilitator ngay trong ngày 1 |
| **S1 — Rails (fallback slice)** | Tool marketplace x402 + TalkMeter per-minute + identity hiển thị + mission record off-chain (người giao, tool cap, expiry) | Mua được tool live, TalkMeter tính tiền theo phút, có tx hash, và có S1 submission pack riêng (07 §4) | Đây đã là một bài nộp được, đừng để S2 làm hỏng S1 |
| **S2 — Guard (core)** | GuardedTreasury + mission on-chain + queue + pause + audit ledger | Test contract/integration/live theo 06 pass, attack test có số trước/sau | Cắt stretch trước, giữ guard lõi + mission |
| **S3 — Trust + bằng chứng + demo** | ERC-8004 feedback từ mission owner, proof bundle, demo 6 scene, video, slides | Feedback đọc lại được trên Fuji; video ≤ 3 phút, mọi claim có tx hash | Cắt scene, không cắt bằng chứng live |
| **S4 — Stretch (chỉ nếu S1–S3 xong)** | 09-breakthroughs.md, theo thứ tự ưu tiên | Mỗi stretch có test riêng, không phá test cũ | Không làm stretch nếu còn < 3 ngày tới deadline |

**Freeze: 17/11.** Sau ngày này chỉ sửa bug, link, video — không thêm feature.

**Deadline an toàn: 21/11 23:59 giờ VN** (Team1). Builder Hub ghi 25/11
nhưng coi như không tồn tại cho kế hoạch. Mục tiêu nội bộ: khóa
submission 20/11, 21/11 chỉ sửa link.

## 7. Rubric mapping — mỗi mục chấm thì xem bằng chứng nào (không dự báo điểm)

Tổng 100 theo rubric chính thức: Technical 25, Avalanche Integration
25, Creativity 15, Impact 15, Presentation 10, UI/UX 10. Xem
07-demo-submission.md §5 để biết bằng chứng cho từng mục. Spec này
không dự báo điểm số hay khả năng thắng — chỉ liệt kê bằng chứng
tương ứng với từng mục.

| Rubric | Bằng chứng tương ứng | Rủi ro lớn nhất |
|---|---|---|
| Technical 25 | Guard + pre-flight + test theo 06 + attack đối chứng | LLM JSON sai, guard bug → demo chết |
| Avalanche 25 | Fuji live: guard, x402, ERC-8004, Snowtrace tx | Facilitator down lúc chấm → phải có tx hash ghi sẵn + fallback |
| Creativity 15 | Mission-scoped budget + receipt/proof bundle + replay giải thích (xem 09, phần core) | Làm giống literal idea → không có trục riêng |
| Impact 15 | Use case mission của nhóm/CLB + tool marketplace, không phải toy | Chỉ demo 1 tool → trông hẹp |
| Presentation 10 | Video 6 scene đúng 2:30, slides 1 claim = 1 tx hash | Nói mock như live |
| UI/UX 10 | Dashboard: policy + mission budget nhìn thấy được, queue 1 click, audit tra được | UI chỉ là form gửi tx |

## 8. Hằng số dùng chung — mọi file sau phải dùng đúng số này

| Hằng số | Giá trị | Ghi chú |
|---|---|---|
| Chain | Fuji, chain ID 43113 | RPC `https://api.avax-test.network/ext/bc/C/rpc` |
| USDC Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65`, 6 decimals | $0.50 = `500000` |
| ERC-8004 Identity (Fuji) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Verify trên testnet.snowtrace.io trước khi dùng |
| ERC-8004 Reputation (Fuji) | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Không dùng địa chỉ mainnet cho Fuji |
| per-tx cap (mặc định demo) | 5 USDC = `5000000` | Owner đổi được, event ghi lại |
| daily cap (mặc định demo) | 20 USDC = `20000000`, cửa sổ ngày UTC | MVP dùng ngày UTC, không phải rolling window (xem 01 §4) |
| Mission treasury cap mặc định | 10 USDC = `10000000`, hết hạn 24h | Enforce on-chain, xem 01 §3–§5 |
| Mission tool cap mặc định | 5 USDC = `5000000`, cùng expiry với mission | Enforce off-chain bởi validator + reservation, xem 02 §9 |
| Queue TTL | 48h tính từ lúc propose, không reset khi approve | `approve()`/`execute()` sau expiry đều revert, xem 01 §6 |
| x402 authorization TTL | 60s (`maxTimeoutSeconds`, `validBefore = now + 60s`) | Pause không thu hồi authorization đã ký trong TTL này |
| Storage deploy | Vercel + hosted Postgres (Supabase) qua Prisma `postgresql` | **Không** dùng file SQLite local trên Vercel, xem 05 §2 |
| Facilitator thử trước | Ultravioleta `https://facilitator.ultravioletadao.xyz` | Fallback theo 02 §2 |

## 9. File nào đọc để làm việc gì

- Muốn code contract → `01-contracts.md` (đủ để viết Solidity không cần hỏi lại).
- Muốn code tool/x402 → `02-x402-tools.md`.
- Muốn gắn identity/reputation → `03-erc8004.md`.
- Muốn code agent/validator/queue → `04-agent.md`.
- Muốn dựng app/API/DB/UI → `05-app.md`.
- Muốn test/bảo mật → `06-tests-security.md`.
- Muốn quay video/làm slides/nộp bài → `07-demo-submission.md`.
- Muốn chia việc theo ngày → `08-build-plan.md`.
- Muốn thêm đột phá mà không phá scope → `09-breakthroughs.md` (làm theo thứ tự).
- Muốn biết nguồn nào copy được → `context/build-sources.md` (đã push trước).

## 10. Giới hạn trung thực — phải giữ trong README, pitch, video

1. Reputation là tín hiệu tin cậy, **không chống Sybil**; validation
   registry ngoài scope MVP. Feedback MVP là quality rating từ
   mission owner, không phải success rate của mọi call.
2. TalkMeter trong hybrid là **một tool trả tiền theo phút**, không phải
   sản phẩm meeting đầy đủ; mic thật ngoài scope, session mô phỏng
   phải ghi là mô phỏng.
3. Daily cap MVP là ngày UTC, không phải rolling 24h — và có kẽ hở
   qua nửa đêm UTC (chi đủ cap lúc 23:59 rồi lại đủ cap lúc 00:01).
   Nói đúng, đừng nói rolling nếu code không làm rolling.
4. Mock mode (nếu dùng rehearsal) phải ghi mock ở video và README.
   Tx hash live Fuji mới là bằng chứng.
5. Facilitator là bên thứ ba: nó không sửa được amount/destination
   trong EIP-3009 đã ký, nhưng nó có thể down — vì vậy tx hash phải
   ghi lại sớm, không dựa vào demo live duy nhất.
6. Pause không thu hồi authorization x402 đã ký trong 60s TTL, và
   không chặn key holder ký trực tiếp ngoài server. Settlement sau
   pause phải ghi là `SETTLED_AFTER_PAUSE`.
7. Hash chain chứng minh integrity + consistency của ledger hiện
   tại, không chứng minh lịch sử chưa từng bị viết lại, và không
   chứng minh chất lượng câu trả lời của agent.
8. Claim an toàn đúng, tách hai trường hợp: LLM bị lừa (không có key)
   thì không chuyển tới recipient trái phép, không vượt cap tự động,
   không approve vô hạn. Key agent bị lộ là trường hợp khác: toolCap
   off-chain không còn enforce được, tổn thất tool tối đa = toàn bộ
   số dư ví tool + mọi lần refill trước khi đóng mission. "0 mất"
   chỉ là kết quả của các kịch bản attack đã chạy, không phải chứng
   minh tổng quát.
9. UNKNOWN không tự thành FAILED/SETTLED: nonce chưa dùng không
   chứng minh thất bại, nonce đã dùng không chứng minh thành công
   (có thể là cancel) — chỉ receipt mới kết luận, xem 02 §9.4.
10. S1 chưa có guard: owner/auth/pause của S1 là off-chain (05 §4b),
    không được giả vờ S1 có guard owner/paused. S2 mới dùng guard.
11. Owner là bên được tin cậy cho ngoại lệ (approve vượt cap) và cho
   emergency withdraw khi paused. Guard bảo vệ quỹ khỏi agent/LLM,
   không bảo vệ khỏi chính owner.
