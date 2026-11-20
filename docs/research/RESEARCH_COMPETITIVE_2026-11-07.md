# MissionPay — quét toàn cảnh đối thủ và tìm gap (v2, 07/11/2026)

v2 thay toàn bộ v1. Bản v1 chỉ tìm bằng từ vựng của chính mình nên sót Kite, Polygon, AgentGuard402, MissionGuard và hàng chục x402 guard.
Lần này quét có hệ thống 6 nhóm, kể cả repo GitHub của các đội trong chính UniHack. Cách làm đã lưu thành skill `competitive-gap-research`.

Ký hiệu độ tin cậy:
- **[repo]**: đã đọc README/repo.
- **[doc]**: tài liệu chính thức.
- **[báo]**: báo hoặc blog bên thứ ba.
- **[vendor]**: bài so sánh do một vendor cạnh tranh viết, có thiên lệch.

---

## 0. Kết luận thẳng

1. **Ý tưởng lõi của MissionPay đã thành hàng phổ thông:** ngân sách cho agent, hạn mức, allowlist người nhận, hạn dùng, chặn on-chain, audit hash chain.
   Ít nhất **40 sản phẩm hoặc repo** có ít nhất 3 trong các tính năng này. Trong đó **3 dự án chạy trên chính Avalanche Fuji**:
   - **AgentGuard402**: contract chặn hạn mức, allowlist và hạn dùng cho x402, có tx thật trên Fuji.
   - **MissionGuard**: ngân sách theo task, escrow, receipt, 53 sao.
   - **Kite AI**: một Avalanche L1 có Agent Passport.
2. **Ban tổ chức UniHack gợi ý sẵn chủ đề "AI agents & security" và "agent economy on x402".**
   → Nên giả định **có vài đội cùng hướng** trong cuộc thi. Không được nói "chúng tôi là đầu tiên".
3. **Cái còn thắng được là chiều sâu, bằng chứng và một góc mới thật sự.** Không thắng được bằng ý tưởng. Gap đã kiểm chứng ở mục 4.
4. **Khả năng vào Top 10 vẫn khá**, vì UniHack chấm theo rubric thực thi và MissionPay đang sâu hơn mặt bằng repo sinh viên đã thấy (mục 2.6). Nhưng **phải sửa định vị** trên deck và trong phần Q&A; nếu không, chỉ một câu "khác gì AgentGuard402/Kite?" là mất điểm Creativity.

---

## 1. Các "nguyên tử năng lực" dùng để so

| Mã | Năng lực |
|---|---|
| C1 | Cap theo lần chi / ngày / tổng |
| C2 | Ngân sách theo task/mission, có hạn dùng, thu hồi được |
| C3 | Chặn on-chain (contract / smart account), không chỉ ở server |
| C4 | Allowlist người nhận |
| C5 | Duyệt bởi người (ngưỡng / hàng đợi) |
| C6 | Audit hash chain **neo on-chain** |
| C7 | x402 trên Avalanche Fuji |
| C8 | ERC-8004 (identity / reputation / validation) |
| C9 | Kiểm người bán (trust score) / escrow trả khi giao hàng |
| C10 | Luật **nguồn gốc dữ liệu** (địa chỉ từ tool output không được làm người nhận) |
| C11 | Ngân sách **xuyên L1** qua Avalanche ICM |
| C12 | Benchmark tấn công có số đo công khai |
| C13 | Demo đối kháng trực tiếp cho khán giả, kết quả do contract quyết định |

## 2. Toàn cảnh theo nhóm

### 2.1 Ví và smart account có quyền hạn on-chain (C1–C4 đều đã là chuẩn)

- **Safe Allowance Module** [doc]: có quickstart "agent with spending limit".
  **Zodiac Roles** [doc]: có trang "Permission an AI agent". Hỗ trợ đo theo budget (WithinAllowance) và theo số lần gọi; tài liệu nhấn mạnh *"allowance limits amounts, not destinations"*, phải kết hợp thêm điều kiện về người nhận.
- **ZeroDev Kernel** (signers / policies / actions), **Biconomy Smart Sessions** (ERC-7579), **Alchemy Modular Account v2** (ERC-6900), **thirdweb** session keys [doc].
- **MetaMask Smart Accounts Kit** (ERC-7710/7715): `erc20PeriodTransfer`, timestamp enforcer, redelegation cho agent [doc].
  Clawnch dùng thật: `$200/day` + expiry [báo].
- **Coinbase Spend Permissions**: `SpendPermissionManager` trên Base [repo].
  Test WalletCap: 2 permission × $150/ngày → agent rút $300 trong 1 giờ, vì cap tính theo permission [repo].
- **Polygon OMS agent spend controls** (21/10/2026): task + budget + expiry trong Sessions Module, không ai nới được sau khi duyệt [báo].
- **Kite AI**: Avalanche L1, mainnet 4/2026, Agent Passport có limit/expiry/session; x402 + AP2; gọi vốn $33M+ [báo].
  Không tìm thấy tài liệu kỹ thuật về cách luật được thực thi.
- **Lit Protocol Vincent**: policy viết bằng Lit Actions, có registry on-chain, giới hạn USD/ngày [repo].
- **Crossmint** (TEE signer + contract), **Privy** (policy off-chain, người nhận, khung thời gian; nay thuộc Stripe), **Turnkey** (policy trong enclave, mặc định chặn) [vendor/doc].

### 2.2 Guard và policy engine off-chain cho agent payments

- **Fintech:** Skyfire (KYA, budget, chặn vendor lạ, duyệt qua SMS), Payman (allowlist người nhận, có version), Nevermined (delegation, ERC-4337), Coinbase Agentic Wallets (policy off-chain, TEE) [vendor/báo].
- **APort / Open Agent Passport:**
  - Kiểm quyền trước mỗi tool call, audit ký số, có hash chain.
  - **APort Vault benchmark:** 4.371 đòn × 14 model, 225.964 lượt đánh giá. Chỉ dùng model: 140/76.842 chuyển tiền trái phép. Có guard: **0/69.297**.
  - Dataset trên Hugging Face, giấy phép CC BY 4.0 [doc].
- **AgentLedger** (agentpayments.fi): budget, giới hạn giá, duyệt tay, pause, audit hash chain **đối chiếu với blockchain hằng ngày** [doc].
- **Countersign** (nhóm Cornell/Yale): duyệt bằng thao tác vật lý trên điện thoại [báo].
- **Hơn 12 repo x402 guard mã nguồn mở**, ví dụ:
  - `x402-spendguard`: có cả **per-mission budgets** và audit chống sửa.
  - `x402-agent-guard`: chạy kịch bản đối kháng.
  - `spend-guard`: phát hiện giá tăng đột biến.
  - `mcpack-x402-guard`: giữ tiền trước, chỉ trừ thật khi đã settle.
  - `x402-spend-guard`: dùng mandate có chữ ký.
  - `XGuard` (XRPL): AUTO / HOLD / DENY + escrow.
  - `agent-x402`, `agent-verifier`, `x402-agent-wallet`, `guardrail-core`.

### 2.3 Hệ sinh thái Avalanche

- **AgentGuard402** [repo]:
  - `AgentPolicyRegistry` + `PolicyVault` trên Fuji.
  - Có per-tx cap, daily cap, allowlist người nhận, expiry, freeze; agent chỉ ký EIP-712, facilitator trả gas.
  - 16 kịch bản (4 cho qua, 12 bị chặn), forge 17/17, có link Snowtrace.
  - Không có ngân sách theo mission, không có proof neo on-chain, không có LLM.
- **MissionGuard** [repo]:
  - Ngân sách theo task, escrow, ủy quyền sâu tới 8 cấp (trừ ngược lên mọi cấp cha), receipt.
  - 12 tx Fuji. **Không phải x402, không có ERC-8004, không có proof neo on-chain**; LLM tắt sẵn.
- **Kite AI L1** (mục 2.1).
- **ChainPe**: thanh toán agent xuyên L1 qua ICM (sender/receiver), code hackathon [repo].
- **cloakx402**: x402 riêng tư bằng eERC trên Fuji (Team1 India Speedrun) [repo].
- **hazine-ajani**: risk gate + x402 Fuji [repo].
- **sekisho**: x402 tự chia doanh thu [repo].
- **ava-labs/x402-starter-kit**: có ví dụ "pre-authorize a budget for an AI agent" [repo].
- **hackatwin-x402-team1-avalanche**: tài liệu workshop của Team1: x402 + ERC-8004 + ICM/ICTT, 145 commit [repo].
- **Tenseo Protocol**: thuê agent và trả qua x402 trên Avalanche; **1.600+ agent ERC-8004** [báo, Team1 recap].

### 2.4 Proof, biên lai, escrow cho agent

- **Escrow + đánh giá:**
  - **ERC-8183** (Virtuals + EF, draft): Job, escrow, evaluator.
  - **AEGIS**: escrow + ERC-8004 Validation (ngưỡng 70).
  - **PayCrow**: trust score + escrow + tranh chấp, Base mainnet.
  - **AgentKred** (Stellar), **x402Resolve**, `x402-agent-score` [repo/báo].
- **Audit neo on-chain:** AgentGetPay (BSV), ChainLog (Base), AgentLedger (đối chiếu hằng ngày) [repo/doc].
  Bản không neo chain: agentic-os, agent-receipts.
- **Validation ERC-8004 qua TEE:** Dymension, Oasis ROFL [repo/báo].

### 2.5 Arena / demo tấn công

- **Có tiền thật:** Freysa (2024, ~$45k).
- **Testbed:** APort Vault (agent ngân hàng, có bounty).
- **CTF có leaderboard:** PromptInjects (*"QR code on one slide… big-screen leaderboard"*), HackTheAgent, Gray Swan IPI Arena (8/2026, giải $30k), CrowdStrike AI Unlocked [báo].
- **Không tìm thấy** arena cho ví agent, chạy trực tiếp với khán giả, mà kết quả do validator/contract quyết định và có số liệu tiền ra ngoài phạm vi.

### 2.6 Repo các đội UniHack 2026 tìm thấy

AvaGuard (quét ERC-20), VeriTrade (tài trợ khoản phải thu), AvaHui (hụi on-chain), SALX (tín chỉ carbon), Kinetix (tài chính gia đình), game DeFi farm.
**Chưa thấy đội UniHack công khai nào làm ví hay guard cho agent.** Chỉ thấy repo công khai, nên có thể còn đội để repo private.

### 2.7 Nghiên cứu và sự cố làm bối cảnh

- Vụ **Bankr/Grok** (5/2026, $155–204k).
- **Zscaler** (7/2026): 2 chiến dịch thật giấu lệnh trả tiền trong CSS và JSON-LD; 4/26 model làm theo.
- **Cornell/Yale** (10/2026): 9/10 model tự nâng hạn mức qua OTP email.
- **CaMeL** (SaTML 2026): tách luồng điều khiển khỏi luồng dữ liệu, gắn capability cho từng giá trị.
- **Fake News, Real Crashes**: tin giả đạt 62% với agent giao dịch.
- **SoK Agentic Commerce** (arXiv 2604.15367).

## 3. Ma trận năng lực

✓ = có, ✗ = không, ? = không rõ

| | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | C13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kite AI | ✓ | ✓ | ✓ | ? | ? | ? | ✗ (L1 riêng) | ? | ? | ✗ | ✗ | ✗ | ✗ |
| Polygon OMS | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Safe/Zodiac, ZeroDev, Biconomy, MetaMask, Coinbase SP | ✓ | ~ | ✓ | ✓ | ~ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| APort / OAP | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ (ký số, không neo) | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | testbed |
| AgentLedger | ✓ | ✓ | ✗ | ✓ | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| x402-spendguard và các x402 guard | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ (chống sửa local) | ✗ | ✗ | ✗ | ✗ | ✗ | ~ | ✗ |
| **AgentGuard402** | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ (USDC mock) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **MissionGuard** | ✓ | ✓ | ✓ | ? | ✗ | ✗ | ✗ (không x402) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| PayCrow / AEGIS / ERC-8183 | ✗ | ✓ (job) | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ |
| ChainPe | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ? | ✗ | ✗ | ~ (chỉ chuyển payment) | ✗ | ✗ |
| **MissionPay (hiện tại)** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Circle USDC + 2 facilitator) | ✓ | ~ (price guard) | ~ (allowlist) | ✗ | ✗ | **✓** |

## 4. Gap đã kiểm chứng

Mỗi gap được xác nhận bằng ít nhất 2 lượt tìm có mục tiêu mà không thấy ai làm.

| Gap | Ai gần nhất | Vì sao còn trống | Độ tin cậy |
|---|---|---|---|
| **G1. Luật nguồn gốc dữ liệu ở lớp thanh toán (C10).** Địa chỉ, giá hay mã OTP xuất hiện trong dữ liệu không tin cậy thì không bao giờ được dùng để chi tiền hoặc đổi luật, kể cả khi nằm trong cap. | CaMeL (nghiên cứu chung, không về thanh toán); Zodiac cảnh báo "amounts, not destinations" | Các guard đều dùng allowlist tĩnh hoặc trust score; chưa thấy ai gắn nhãn nguồn cho tham số thanh toán | Trung bình–cao |
| **G2. Benchmark công khai cho guard on-chain trên Avalanche (C12).** Replay một phần dataset APort Vault (CC BY 4.0) và các đòn Bankr, Zscaler, Cornell vào MissionPay, kèm Snowtrace. | APort (guard off-chain, không có chain) | Chưa thấy guard on-chain nào công bố số đo trên dataset chung | Cao |
| **G3. Arena khán giả cho ví agent, kết quả do contract quyết định (C13).** | PromptInjects (CTF chung), APort Vault (off-chain) | Chưa thấy bản wallet + Avalanche | Cao |
| **G4. Ngân sách mission xuyên L1 qua ICM (C11).** Treasury trên C-Chain; agent chi trên một L1 khác; mỗi khoản chi bị trừ vào cap của mission qua ICM. | ChainPe (chỉ chuyển payment), hackatwin (relay simulator) | Search ghi rõ không có chuẩn hay sản phẩm nào cho budget xuyên L1 | Cao (nhưng **khó làm trong 10 ngày**) |
| G5. Kết hợp đầy đủ (C2 + C3 + C6 + C7 + C8) trong một sản phẩm trên Avalanche | MissionGuard (thiếu x402, 8004, neo proof), AgentGuard402 (thiếu mission, proof) | Đây là gap về **mức độ hoàn chỉnh**, không phải gap ý tưởng; dễ bị coi là "ghép đồ" | Trung bình |

Đã **lấp kín, không nên nhận là của mình**: cap, ngân sách theo task, chặn on-chain, allowlist, hạn dùng, duyệt tay, audit hash chain, escrow + trust score, duyệt đổi luật bằng chữ ký owner.

## 5. Định vị mới (thay slide 3 và slide 10)

Câu chốt mới:
> "Spending caps are everywhere now — even on Avalanche (Kite, AgentGuard402). They stop *how much*. They don't stop *who* when the recipient came from a poisoned web page. MissionPay tracks where every payment parameter came from, and proves it on Avalanche."

Đề xuất slide 10: bảng 4 cột Kite / AgentGuard402 / Polygon & smart-account kits / MissionPay, với các hàng:
- Cap on-chain: tất cả ✓, nói thẳng là mình không phát minh ra.
- Luật nguồn gốc người nhận.
- Audit neo on-chain + ERC-8004.
- Số đo tấn công công khai.
- Demo khán giả.

## 6. Kế hoạch nâng cấp (tới 18/11)

| # | Việc | Gap | Ai làm | Công sức |
|---|---|---|---|---|
| P0 | Sửa deck slide 3, 10 + câu trả lời Q&A theo mục 5 | — | Reviewer | Thấp |
| P0 | **G1:** `provenance` cho mỗi tham số trong proposal (`OWNER_MISSION` / `TOOL_OUTPUT` / `LLM`); luật `RECIPIENT_UNTRUSTED_PROVENANCE`, `AMOUNT_FROM_UNTRUSTED_SOURCE`; thêm đòn Zscaler (JSON-LD "$3 license") và đòn Cornell (OTP) vào Arena | G1, G3 | Gemini | Trung bình |
| P0 | **Fuji live** (đã lên kế hoạch) | G5 | Owner + Gemini | Thấp phía owner |
| P1 | **G2:** script `attack-eval` replay N đòn (dataset APort, ghi nguồn + các đòn sự cố thật) × 2 model (cần `GEMINI_API_KEY`) → `docs/security/ATTACK_EVAL.md`: LLM bị lừa X%, tiền ra ngoài phạm vi 0, kèm link tx bị contract chặn | G2 | Gemini | Trung bình |
| P2 | **G4 rút gọn:** chỉ đưa vào roadmap và slide, *không* hứa demo | G4 | — | — |

## 7. Q&A chuẩn bị

- **"Khác gì AgentGuard402 / MissionGuard?"**
  Họ chặn số tiền và danh sách người nhận. Mình chặn **nguồn gốc** của người nhận và số tiền, có x402 thật với Circle USDC, ERC-8004, proof neo on-chain, và số đo tấn công công khai.
- **"Khác gì Kite?"**
  Kite là cả một L1. MissionPay là lớp chính sách và proof chạy trên C-Chain; về nguyên tắc chạy được trên mọi L1 EVM của Avalanche, kể cả Kite.
- **"Smart account đã có session key rồi?"**
  Đúng, và đó là điều kiện cần. Nhưng như tài liệu Zodiac viết, allowance giới hạn số tiền chứ không giới hạn điểm đến. Mình chặn điểm đến theo nguồn gốc dữ liệu.

## 8. Nguồn

**Ví và smart account**
- [Safe agent spending limit](https://docs.safe.global/home/ai-agent-quickstarts/agent-with-spending-limit)
- [Zodiac Roles AI agents](https://docs.zodiac.eco/developers/roles/ai-agents)
- [ZeroDev permissions](https://docs.zerodev.app/sdk/permissions/intro)
- [Biconomy session policies](https://docs.biconomy.io/agents-automation/policies/index)
- [Alchemy session model](https://www.alchemy.com/overviews/agent-wallets-session-permission-model)
- [MetaMask spending-limit scopes](https://docs.metamask.io/smart-accounts-kit/1.7.0/guides/delegation/use-delegation-scopes/spending-limit/)
- [Coinbase spend-permissions](https://github.com/coinbase/spend-permissions)
- [WalletCap](https://github.com/coriolislabs/WalletCap/pull/7)
- [Polygon OMS](https://stablecoininsider.org/polygon-agent-spend-controls/)
- [Kite (Messari)](https://messari.io/report/kite-the-payment-layer-for-the-agentic-economy)
- [Lit Vincent](https://github.com/LIT-Protocol/Vincent)
- [Crossmint compare](https://www.crossmint.com/learn/agent-wallets-compared)
- [Privy agent wallets](https://www.privy.io/agent-wallets)
- [Turnkey agentic](https://docs.turnkey.com/solutions/company-wallets/agentic-wallets)

**Guard off-chain**
- [APort Vault](https://arxiv.org/html/2609.22076v1)
- [OAP](https://arxiv.org/html/2603.20953v1)
- [AgentLedger](https://www.agentpayments.fi/docs/)
- [Skyfire / Payman / Nevermined compare](https://pinkwallet.com/agentic/learn/ai-agent-spend-governance-tools-compared/)
- Repo x402 guard:
  - [x402-spendguard](https://github.com/baby-zack-agent/x402-spendguard)
  - [x402-agent-guard](https://github.com/kfangw/x402-agent-guard)
  - [spend-guard](https://github.com/vulinh1704/spend-guard)
  - [mcpack-x402-guard](https://github.com/amilycc0902-png/mcpack-x402-guard)
  - [x402-spend-guard](https://github.com/sparkmastergrape/x402-spend-guard)
  - [XGuard](https://github.com/zh315-bit/XGuard)
  - [agent-x402](https://github.com/doomsday-network/agent-x402)
  - [agent-verifier](https://github.com/goodmeta/agent-verifier)
  - [x402-agent-wallet](https://github.com/nirholas/x402-agent-wallet)

**Avalanche**
- [AgentGuard402](https://github.com/Chichuzxy/AgentGuard402)
- [MissionGuard](https://github.com/yccccccc886/missionguard)
- [ChainPe](https://github.com/SamyaDeb/chainpe-monad)
- [cloakx402](https://github.com/Allen-Saji/cloakx402)
- [hazine-ajani](https://github.com/Sahveli01/hazine-ajani)
- [x402-starter-kit](https://github.com/ava-labs/x402-starter-kit)
- [hackatwin](https://github.com/sebastianlujan/hackatwin-x402-team1-avalanche)
- [Team1 recap 02/2026](https://www.team1.blog/p/avalanche-february-2026-recap)
- [Team1 recap 10/2026](https://www.team1.blog/p/avalanche-october-2026-recap)

**Proof và escrow**
- [ERC-8183](https://www.dwellir.com/blog/erc-8183-agentic-commerce-explained)
- [AEGIS](https://paragraph.com/@srehman/introducing-aegis-trustless-escrow-for-the-agent-economy)
- [PayCrow](https://dev.to/michu5696/add-escrow-protection-to-any-x402-agent-payment-in-5-minutes-1n0b)
- [AgentKred](https://github.com/devasignhq/agentkred)
- [awesome-erc8004](https://github.com/sudeepb02/awesome-erc8004)
- [AgentGetPay](https://github.com/alfredlog/agentgetpay)
- [ChainLog](https://github.com/Arete-Consortium/chainlog)
- [Dymension validation](https://github.com/dymensionxyz/dymension/issues/2219)

**Arena / CTF**
- [PromptInjects](https://promptinjects.com/)
- [HackTheAgent](https://red-orbita.com/en/posts/2026/08/hacktheagent-breaking-all-5-challenges-of-ethiacks-ai-agent-ctf/)
- [Gray Swan IPI](https://app.grayswan.ai/arena/challenge/ipi-aug-2026?panel=rules)
- [CrowdStrike AI Unlocked](https://www.crowdstrike.com/en-us/blog/introducing-ai-unlocked-interactive-prompt-injection-challenge/)

**Sự cố và nghiên cứu**
- Bankr: [Cointelegraph](https://cointelegraph.com/magazine/grok-bankr-wallet-free-nft-prompt-injection), [OECD.AI](https://oecd.ai/en/incidents/2026-05-04-4a73)
- [Zscaler](https://www.zscaler.com/blogs/security-research/indirect-prompt-injection-web-content-targets-ai-agents)
- [Cornell/Yale (CoinDesk)](https://www.coindesk.com/tech/2026/11/01/ai-agents-bypassed-crypto-spending-limits-without-human-approval-researchers-find-in-a-new-test)
- [CaMeL](https://arxiv.org/html/2503.18813v2)
- [Fake News, Real Crashes](https://arxiv.org/abs/2610.26438)
- [SoK Agentic Commerce](https://arxiv.org/abs/2604.15367)

**UniHack**
- [team1vn.xyz](https://team1vn.xyz/)
- Repo các đội: [AvaGuard](https://github.com/ChieNg00/AvaGuard), [AvaHui](https://github.com/QCuong-SW/avahui-unihack-2026), [VeriTrade](https://github.com/NghiaaPham/hackathon)
