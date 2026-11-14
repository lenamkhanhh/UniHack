# MissionPay — kiểm SOTA và prior work (v3, 08/11/2026)

Bổ sung cho `RESEARCH_COMPETITIVE_2026-11-07.md` (v2). Lần này kiểm riêng 7 phần mới làm trong plan WOW, và quét lại các đối thủ mới xuất hiện trong 30 ngày qua.

## 0. Kết luận thẳng

- **MissionPay không phải "SOTA" theo nghĩa vượt trội mọi giải pháp, và không được nói như vậy.**
  - Về tỉ lệ tấn công thành công (ASR): ít nhất 5 guard off-chain đã đạt khoảng 0% trên AgentDojo banking (ProvGuard, NOMOS, AgentFlow, aiAuthZ, SPILLWAY).
  - Số 0/277 của mình đo trên bộ case tự tạo, nên không so trực tiếp được với họ.
- **Từng ý riêng lẻ đều đã có người làm:**
  - Luật nguồn gốc (provenance): ProvGuard (20/10), SPILLWAY (04/11).
  - Allowlist người nhận on-chain: AgentGuard402 trên Fuji, allowance-ai trên NEAR.
  - Passkey kiểm on-chain: allowance-ai, MoonPay PayBox, Countersign.
  - Arena hay bounty cho khán giả: Freysa, arena của allowance-ai, bản nháp "Unbreakable Treasury" của Modality.
  - Sửa lỗ x402 replay: conformance test XC-08, pay-kit của Solana Foundation.
  - ERC-8004 Validation: Markovian trên Base Sepolia, pokt VNI.
- **Đối thủ gần nhất mới xuất hiện: allowance-ai.** Repo tạo ngày 02/11/2026 cho NEAR Hackathon, track AI Security.
  - Slogan "Give your AI agent an allowance, not your wallet" gần như trùng câu chốt của mình.
  - Đã có cap, allowlist và Face ID kiểm on-chain, có arena, có relay không giữ key.
  - Bộ kiểm passkey của họ **chặt hơn** của mình: kiểm cả origin, RP ID và cờ user-verified, có 34 test.
- **Gap thật còn lại (độ tin cậy trung bình–cao):**
  - Tập người nhận gói theo **từng mission**, được **thực thi on-chain**.
  - Chính paper NOMOS (10/2026) ghi rõ đây là lỗ của họ: agent vẫn chuyển hướng được tiền sang một payee đã có trong lịch sử giao dịch (8/288 cặp).
  - Benchmark E10 của mình đo đúng lỗ này: allowlist thường lọt 17/20 và 19/20, MissionPay lọt 0.
  - Các guard provenance đều chạy off-chain, nên server bị chiếm là mất. Các guard on-chain chỉ dùng một allowlist chung cho cả tài khoản.

## 1. Các năng lực dùng để so (bổ sung C14–C18)

| Mã | Năng lực |
|---|---|
| C3 | Chặn on-chain |
| C4 | Allowlist người nhận (cho cả tài khoản) |
| C10 | Luật nguồn gốc (provenance) cho tham số thanh toán |
| C12 | Benchmark tấn công có số đo |
| C13 | Arena / bounty cho khán giả |
| **C14** | Tập người nhận **theo từng mission/task**, ký bởi owner (không phải lịch sử, không phải allowlist chung) |
| **C15** | x402 ràng chữ ký thanh toán vào đúng request (chống đổi request / replay) |
| **C16** | ERC-8004 Validation có validator độc lập, dùng thật |
| **C17** | Owner duyệt bằng passkey, kiểm chữ ký on-chain |
| **C18** | Chứng minh bất biến (fuzz invariant + symbolic) cho guard |

## 2. Toàn cảnh mới theo nhóm

### 2.1 Guard provenance / IFC off-chain (nhóm mạnh nhất về ASR)

- **ProvGuard** (GitHub, tạo 20/10/2026) [repo]
  - Cách làm: một tham số (người nhận, IBAN, số tiền) chỉ được dùng khi có nguồn tin cậy chứa nó.
  - Kết quả: AgentDojo banking, ASR từ 33% xuống 0% (0/48, cận trên 95% khoảng 6%); chặn nhầm 3/16 task hợp lệ.
  - Chạy off-chain, có cả proxy MCP.
- **NOMOS** (arXiv 2610.11030, 08/10/2026) [paper]
  - Cách làm: gate chỉ cho trả cho người mà user đã nêu, hoặc đã có trong lịch sử giao dịch.
  - Kết quả: ASR 0% trên 288 cặp.
  - Tự ghi điểm yếu: agent vẫn chuyển hướng tiền sang một payee đã có trong lịch sử, 8/288 cặp (11/140 với Llama-3.3-70B). Không dùng blockchain.
- **SPILLWAY** (arXiv 2611.07222, 04/11/2026, workshop NeurIPS 2026) [paper]
  - Cách làm: một giá trị đích chỉ được nhận nếu đến từ một trường có kiểu (typed field) của tool chỉ đọc.
  - Kết quả: ASR trung bình 0.007 trước attacker RL. Có code. Không dùng blockchain.
- **AgentFlow** (2608.22868): tỉ lệ bị chiếm trên banking từ 66% xuống 0%.
- **aiAuthZ** (2607.05518): allowlist người nhận đã biết, chặn chắc chắn, nhưng utility rơi từ 100% xuống 80% vì chặn mất payee mới hợp lệ. Họ ghi rằng model 2026 tự chống được nên ASR không có defense vốn đã bằng 0.
- **NeuroTaint** (2604.23374), **FIDES** (Microsoft), **APPA** (2607.24625): IFC tổng quát cho agent.

### 2.2 Guard on-chain cho ví agent

- **allowance-ai** (NEAR, tạo 02/11/2026, 0 sao) [repo]
  - Agent chỉ có function-call key gọi được duy nhất hàm `agent_spend`.
  - Contract kiểm: allowlist, cap mỗi lần, cap theo cửa sổ thời gian. Ngoài các điều kiện đó thì giữ lại chờ owner duyệt bằng Face ID.
  - Passkey kiểm bằng `env::p256_verify`: kiểm type, challenge, origin, hash RP ID, cờ UP/UV, và chặn chữ ký high-S.
  - Có arena, relay không giữ key, 34 test contract.
  - **Không có:** tập người nhận theo mission, provenance, x402, neo proof, ERC-8004, benchmark có số đo.
- **AgentGuard402** (Fuji) và **AgentContract/AgentBudget**: allowlist chung, cap; AgentContract có `requestId` cho 402. Không theo mission, không có provenance.
- **PayShield-NEAR**: vault kiểm người nhận và quota.
- **MoonPay PayBox**: passkey duyệt từng giao dịch, kiểm trên server. **Countersign** (Cornell Tech + Yale, 26/10/2026): duyệt bằng hành động vật lý trên thiết bị riêng. **Turnkey / Privy / Openfort**: policy key P-256, ERC-7715.

### 2.3 x402

- **XC-08** trong atsp x402-conformance (21/10/2026): một thanh toán đã settle không được cho phép một request khác.
- **solana-foundation/pay-kit #236**: ràng route/memo vào challenge, giữ chỗ chống replay theo kiểu nguyên tử.
- **presidio-hardened-x402** (arXiv 2604.11430): ReplayGuard dùng HMAC.
- **Advisory V12** (22/10/2026): 3 lỗi SDK x402.
- **Issue x402 #3961**: spec v2 chỉ chống replay ở tầng chain.
- → Ràng nonce vào request **không phải ý mới**. Chỉ nên nói là "làm theo các lỗ đã được công bố".

### 2.4 ERC-8004 Validation

- Registry đã có trên mainnet Ethereum và Base từ 01–02/2026, cùng hơn 20 mạng.
- **Markovian**: validationResponse dạng replay xác định trên Base Sepolia.
- **pokt-network/erc-8004-vni**: bản nháp ERC về mạng validator (PR #1808).
- **LLM4Agents** (khoảng 08/2026): "registry thứ ba đang live nhưng trống" trên Ethereum, có issue #28 về validator gian lận. Đây là nguồn duy nhất cho nhận định này.
- → Mình là một trong số ít đội **dùng thật**, nhưng không được nói "đầu tiên".

### 2.5 Arena / bounty

- **Freysa** (11/2024): mất khoảng 47 nghìn USD ở lượt thử thứ 482.
- **allowance-ai /arena** (11/2026).
- **Modality "Unbreakable Treasury"**: bản nháp ngày 23/02/2026, chưa chạy.
- **Gray Swan IPI Black**: giải 300 nghìn USD, 10–11/2026.
- → Bounty là **định dạng demo đã quen**. Giá trị của mình nằm ở chỗ kết quả do contract trên Fuji quyết định, có số đọc từ chain.

### 2.6 Chứng minh hình thức

- 2 lần search ("formally verified agent spending guard Halmos/Certora", "agent wallet invariant") **không thấy** guard thanh toán cho agent nào công bố chứng minh Halmos hay invariant fuzz.
- Gần nhất: "Type-Checked Compliance" (Lean 4, 2604.01483), là guardrail tài chính, không phải contract.

### 2.7 Cùng chain, cùng cuộc thi

- **Avalanche:** không thấy sản phẩm agent-wallet-policy mới của Ava Labs trong 10–11/2026.
  - NEC × Ava Labs (biometric) mới ở giai đoạn thăm dò.
  - Kite gia nhập Payments Collective ngày 08/07.
- **UniHack 2026:** TRUSTPACT (x402 cho escrow xã hội), IntraCampus L1, AvaHui, ScamLens, AvaGuard (quét ERC-20). **Chưa thấy đội nào làm guard thanh toán cho agent.**

## 3. Ma trận năng lực

| | C3 on-chain | C4 allowlist | C10 provenance | C12 benchmark | C13 arena | C14 payee theo mission | C15 x402 bind | C16 8004 Validation | C17 passkey on-chain | C18 chứng minh |
|---|---|---|---|---|---|---|---|---|---|---|
| ProvGuard [repo] | ✗ | ~ (nguồn tin cậy) | **✓** | ✓ AgentDojo | ~ playground | ✗ | ✗ | ✗ | ✗ | ✗ |
| NOMOS [paper] | ✗ | ✓ (lịch sử) | ✓ | ✓ AgentDojo | ✗ | ✗ (tự nhận lỗ) | ✗ | ✗ | ✗ | ~ (gate kiểm tĩnh) |
| SPILLWAY [paper] | ✗ | ✗ | ✓ (typed field) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| aiAuthZ [paper] | ✗ (off-host) | ✓ | ✗ | ✓ AgentDojo | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| allowance-ai [repo] | ✓ (NEAR) | ✓ | ✗ | ✗ | **✓** | ✗ | ✗ | ✗ | **✓ (chặt hơn mình)** | ✗ |
| AgentGuard402 [repo] | ✓ (Fuji) | ✓ | ✗ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ | ✗ |
| AgentContract [repo] | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ~ (requestId) | ✗ | ✗ | ✗ |
| Freysa / Modality | ~ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| XC-08 / pay-kit | — | — | — | — | — | — | **✓** | — | — | — |
| Markovian / pokt VNI | — | — | — | — | — | — | — | **✓** | — | — |
| **MissionPay** | ✓ (Fuji) | ✓ | ✓ | ✓ (tự tạo, 2 model) | ✓ (Fuji, có số từ chain) | **✓** | ✓ | ✓ | ✓ (chưa kiểm origin, RP ID) | **✓** |

## 4. Gap đã kiểm chứng

| Gap | Ai gần nhất | Vì sao còn trống | Độ tin cậy |
|---|---|---|---|
| **G1. Tập người nhận theo mission, owner ký, thực thi on-chain (C14 + C3)** | NOMOS (theo lịch sử, off-chain); allowance-ai / AgentGuard402 (allowlist chung, on-chain) | NOMOS tự ghi lỗ chuyển hướng tiền sang payee đã biết (8/288). Search "per-task payee Merkle root on-chain" không ra kết quả nào (2 lần) | Cao |
| **G2. Provenance + on-chain cùng lúc cho thanh toán (C10 + C3)** | ProvGuard, SPILLWAY (provenance off-chain); allowance-ai (on-chain, không có provenance) | Nhóm provenance không dùng chain; nhóm on-chain không có provenance | Trung bình–cao |
| **G3. Chứng minh fuzz + symbolic cho guard thanh toán của agent (C18)** | Lean 4 "Type-Checked Compliance" (không phải contract) | 2 lần search không thấy | Trung bình |
| G4. Đủ cả gói trên Avalanche (x402 + 8004 Validation + neo proof + bounty trên Fuji) | AgentGuard402 | Đây là gap về mức độ hoàn chỉnh, không phải gap ý tưởng | Trung bình |

**Đã có người làm, không được nhận là của mình:**
- Luật provenance cho tham số tool (ProvGuard, SPILLWAY, NOMOS, FIDES).
- ASR 0% trên benchmark (nhiều guard đã đạt).
- Passkey duyệt on-chain (allowance-ai).
- Arena hay bounty cho khán giả (Freysa, allowance-ai).
- Ràng x402 vào request (XC-08, pay-kit).
- Dùng ERC-8004 Validation (Markovian).
- Allowlist on-chain (AgentGuard402).

## 5. Định vị mới và các slide phải sửa

**Câu định vị:**
> Guard provenance chặn được payee lạ, nhưng vẫn để tiền chạy sang một payee *quen*, và đều chạy trên server. MissionPay khóa payee theo từng mission do owner ký, và chính contract trên Avalanche thực thi.

| Slide | Hiện tại | Sửa |
|---|---|---|
| 12 Competition | Tiêu đề "Caps are table stakes. Provenance is the gap"; bảng chỉ có Kite, AgentGuard402, smart-account | Tiêu đề: **"Others stop strangers. We also stop familiar payees outside the mission"**. Thêm 2 cột: **Provenance guards (ProvGuard, NOMOS, SPILLWAY)** và **allowance-ai (NEAR)**. Thêm hàng "Payee is on the company list but not in this mission": tất cả ✗ ("NOMOS: 8/288 slip"), MissionPay ✓. Hàng "Enforced on-chain": provenance guards ✗. Sửa hàng "Blocks payees from web/tool output": provenance guards **Yes** (không ghi "No" cho cả nhóm) |
| 9 Benchmark | Chỉ so với "No guard" và "Caps + allowlist" | Thêm dòng ngữ cảnh: "Off-chain provenance guards also reach ≈0% on AgentDojo banking (ProvGuard, NOMOS). The case they leave open is a payee already known to the account (NOMOS: 8/288). That is our vendor-diversion set: 17/20 and 19/20 slip past an allowlist, 0 past MissionPay." |
| 7 Bounty | Không có câu "đầu tiên" | Giữ nguyên. Chuẩn bị Q&A về Freysa và allowance-ai |
| 11 Avalanche (Passkey) | "verifies it on-chain" | Đúng, nhưng phải **làm chặt bộ kiểm** (xem mục 6) trước khi demo |
| 8 Defense | "Proved, not just tested" | Giữ nguyên. Đây là G3; ghi chú thuyết trình đã nói rõ phạm vi giới hạn |
| 5, 14 | "give your agent a mission, not your wallet" | Câu này rất gần slogan của allowance-ai ("an allowance, not your wallet"). Hai bên làm độc lập, nhưng nên **đổi** để tránh bị coi là chép, ví dụ: "Sign the mission once. The chain enforces who gets paid." |

## 6. Việc nâng cấp

| # | Việc | Gap | Ai làm | Công sức |
|---|---|---|---|---|
| P0 | Sửa slide 9, 12, 5, 14 theo mục 5 | G1 | Claude | Thấp |
| P0 | **Làm chặt bộ kiểm passkey:** lưu `rpIdHash` lúc deploy và kiểm `authenticatorData[0:32]`; kiểm origin trong `clientDataJSON`; tùy chọn bắt cờ UV. Thêm test: origin giả (phishing), sai RP ID, có UP nhưng thiếu UV, chữ ký đăng ký bị dùng lại làm assertion. Ngang bằng bộ 34 test của allowance-ai | C17 | Gemini | Thấp–trung bình |
| P1 | Thêm vào PayBench nhóm case "payee đã có trong lịch sử" theo mô hình NOMOS (cho cả C1 dùng allowlist theo lịch sử), để chứng minh G1 bằng một kịch bản do chính người khác công bố | G1 | Gemini | Trung bình |
| P2 | Chạy MissionPay policy trên AgentDojo banking (port payee-set + provenance) để có số so cùng thước đo với ProvGuard/NOMOS | C12 | Gemini | Cao, chỉ làm nếu còn thời gian |

## 7. Q&A

- **"ProvGuard, NOMOS, SPILLWAY đã đạt 0% rồi, các bạn hơn gì?"**
  - Họ chạy trên server của agent, nên server bị chiếm là mất. Họ cho trả tới người đã biết, và NOMOS tự ghi 8/288 lượt chuyển hướng sang payee quen.
  - MissionPay giới hạn theo từng mission, do contract trên Avalanche thực thi kèm bằng chứng Merkle.
  - Ca payee quen là đúng bộ E10 của mình: allowlist lọt 17/20 và 19/20, MissionPay lọt 0.
  - Mình không nói ASR của mình tốt hơn họ, vì đo trên benchmark khác nhau.
- **"allowance-ai trên NEAR làm y hệt?"**
  - Giống ở chỗ cap, allowlist, Face ID và arena on-chain.
  - Khác ở 4 điểm: payee theo mission (họ dùng allowlist chung, nên một vendor có trong allowlist sẽ được trả ngay); provenance; x402 trên Avalanche kèm ràng request; neo proof cộng ERC-8004 Validation; và có benchmark đo bằng LLM thật.
  - Bộ kiểm passkey của họ hiện chặt hơn: nếu chưa làm xong P0 thì thừa nhận, và nói đang bổ sung kiểm origin và RP ID.
- **"AgentGuard402 cũng trên Fuji?"** Họ có allowlist chung cho cả tài khoản, cộng cap. Không có mission, không có provenance, không neo proof, không có benchmark.
- **"Freysa đã làm bounty từ 2024?"** Đúng, và Freysa mất tiền vì guard nằm trong prompt. Bounty của mình để contract quyết định, và số liệu đọc trực tiếp từ chain.

## 8. Nguồn

- [ProvGuard (GitHub)](https://github.com/ziko-asm/provguard)
- [NOMOS, arXiv 2610.11030](https://arxiv.org/html/2610.11030v1)
- [SPILLWAY, arXiv 2611.07222](https://arxiv.org/abs/2611.07222)
- [aiAuthZ, arXiv 2607.05518](https://arxiv.org/pdf/2607.05518)
- [AgentFlow, arXiv 2608.22868](https://arxiv.org/pdf/2608.22868)
- [ARGUS, arXiv 2605.03378](https://arxiv.org/html/2605.03378v1)
- [NeuroTaint, arXiv 2604.23374](https://arxiv.org/pdf/2604.23374)
- [APPA, arXiv 2607.24625](https://arxiv.org/pdf/2607.24625)
- [ADI, arXiv 2607.05120](https://arxiv.org/abs/2607.05120)
- [AP2 whisper, arXiv 2609.11757](https://arxiv.org/pdf/2609.11757)
- [allowance-ai (GitHub)](https://github.com/ritesh59697/allowance-ai)
- [AgentGuard402 (GitHub)](https://github.com/Chichuzxy/AgentGuard402)
- [AgentContract (GitHub)](https://github.com/shrish346/AgentContract)
- [PayShield-NEAR (GitHub)](https://github.com/Alafedoyinsola/PayShield-NEAR)
- [Modality: Unbreakable Treasury](https://www.modality.org/docs/proposals/unbreakable-treasury)
- [Gray Swan IPI Black (Fortune)](https://fortune.com/2026/10/21/how-to-catch-an-ai-model/)
- [Cornell/Yale + Countersign (CoinDesk)](https://www.coindesk.com/tech/2026/11/01/ai-agents-bypassed-crypto-spending-limits-without-human-approval-researchers-find-in-a-new-test)
- [atsp x402-conformance XC-08](https://github.com/atsp-protocol/x402-conformance/pull/6)
- [solana-foundation/pay-kit #236](https://github.com/solana-foundation/pay-kit/pull/236)
- [x402 issue #3961](https://github.com/x402-foundation/x402/issues/3961)
- [presidio-hardened x402, arXiv 2604.11430](https://arxiv.org/html/2604.11430v2)
- [x402 SDK advisory (Orbis)](https://orbisappsec.com/advisories/x402-sdk-flaws-ai-agent-wallets)
- [ERC-8004 Validation Network PR #1808](https://github.com/ethereum/ERCs/pull/1808)
- [LLM4Agents: ERC-8004's third registry is live and empty](https://llm4agents.com/blog/erc-8004-registries-onchain-audit)
- [Type-Checked Compliance (Lean 4), arXiv 2604.01483](https://arxiv.org/pdf/2604.01483)
- [Blockworks: State of Avalanche Q3 2026](https://x.com/Blockworks/status/2118780480849948705)
- [NEC × Ava Labs (Biometric Update)](https://www.biometricupdate.com/202607/nec-ava-labs-building-on-chain-verification-layer-for-ai-agents-stablecoins)
- UniHack 2026 repos: [TRUSTPACT](https://github.com/bontran012/TRUSTPACT), [IntraCampus L1](https://github.com/pmai4118-ux/intracampus-l1), [AvaGuard](https://github.com/ChieNg00/AvaGuard)
