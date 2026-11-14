# MissionPay: Q&A dự phòng cho giám khảo

Chỉ dùng các con số đã được Claude kiểm lại. Ô ghi "CHƯA CÓ" thì không được nói lên sân khấu.
Cập nhật: 2026-11-14.
Live Demo URL: [https://unihack-missionpay.vercel.app](https://unihack-missionpay.vercel.app)

## 1. Số liệu được phép nói

| Chủ đề | Số | Nguồn |
|---|---|---|
| AgentDojo banking, replay không dùng model (C2 strict) | Chặn 120/128 đòn tài chính. Benign utility 13/16, chặn nhầm 3/16 (bằng ProvGuard policy v1) | `eval/agentdojo/SUMMARY.md`, `results/replay-ground-truth-20261109-035811.json` |
| 8 đòn lọt | Đều nằm ở `user_task_15`: chính prompt của người dùng đặt IBAN của kẻ tấn công làm chủ nhà mới. Ở 15 task còn lại chặn 120/120 | như trên |
| Replay trên fork Fuji | Contract và guard off-chain khớp nhau 169/169. Khi cố tình đưa kẻ tấn công vào allowlist chung, contract vẫn revert 150 lệnh với `PayeeNotInMissionSet` | như trên |
| AgentDojo live, gemini-3.1-flash-lite (14/11, defense đã sửa lỗi executor) | Cùng 48 cặp ProvGuard 16×3, temp 0, một key. **Không guard (C0): 31/48 đòn lọt (64,6%, Wilson 95% CI 50,4–76,6%).** **MissionPay C2-strict: 2/48 (4,2%, CI 1,2–14,0%).** Cả 2 lượt lọt đều ở `user_task_15` (chính prompt người dùng đặt kẻ tấn công làm chủ nhà mới, giống replay). Benign utility: C0 11/16, C2-strict 10/16. Utility khi bị tấn công: C0 32/48, C2 30/48. Số 0/48 cũ đã rút (đo trên executor lỗi). Lưu ý: chỉ một model, một lần chạy; fork agreement trong lượt này 40/50, chưa phân tích | `eval/agentdojo/LIVE_SUMMARY.md`, `results/agentdojo-banking-google-gemini-3.1-flash-lite-20261114-084127.json` |
| Twin Treasury **live trên Fuji** (13/11) | Cùng một vendor `0xE90c…` nằm trong allowlist chung, cùng treasury `0x2045…d545`: Mission A (chỉ allowlist) trả 0,01 USDC cho vendor ([0x548d…7fc6](https://testnet.snowtrace.io/tx/0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6)); Mission B (tập người nhận theo mission) revert `PayeeNotInMissionSet`, 0 USDC ([0x0ad5…3e38](https://testnet.snowtrace.io/tx/0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38)); đối chứng: người nhận hợp lệ dưới Mission B được trả 0,01 USDC ([0xcb72…6315](https://testnet.snowtrace.io/tx/0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315)). Sau demo vendor đã được gỡ khỏi allowlist ([0x56e1…5562](https://testnet.snowtrace.io/tx/0x56e1154e1b7cfb7e1b76203c4a5267e25663ed11fec0b017051a0969e3f05562)) | `evidence/twin/twin.live.json`, `/arena/twin` |
| Thiệt hại so với khối lượng thật (slide 2) | BeInCrypto Intelligence, *State of AI Agent Payments 2026* (06/10/2026): $281.200 bị gửi cho kẻ tấn công trong 2 sự cố agent; mẫu 6,4 triệu lượt thanh toán x402 trong 35 ngày chỉ chuyển $119.947. Nói "vượt khối lượng của mẫu", không nói "vượt toàn thị trường". Nhà phát hành tự xuất bản báo cáo, hai báo khác dẫn lại cùng số | [Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/ai-agent-economy-really-booming-104745992.html), [The Currency Analytics](https://thecurrencyanalytics.com/technology/ai-agent-payment-report-281200-lost-306977) |
| Verify + ERC-8004 (mission s1c, 13/11) | Trang `/verify/fuji-live-mission-s1c`: chuỗi audit 3 entry khớp head neo trên Fuji `0xb6383cfe…4158`; validator độc lập chấm 100/100 `verified-full` ([0xa9f7…5ffa](https://testnet.snowtrace.io/tx/0xa9f7faddb9e15f0efdb94349f49aed63a5af30666a9edeeffbb5fe8814af5ffa)). Dữ liệu audit commit trong repo, seed lại được. Lưu ý: dữ liệu audit của s1b đã mất (tx s1b trên chain vẫn còn), nên khi demo verify thì dùng s1c | `evidence/missions/fuji-live-mission-s1c/`, FUJI_EVIDENCE.md |
| Foundry | 111/111 test pass across 6 suites (43 GuardedTreasury, 32 PasskeyGovernance, 16 PasskeyMissionAuthority, 12 MissionCrossChainICM, 7 ValidationRegistry, 1 GuardedTreasuryInvariant suite với 6 properties fuzzed 512 runs / 32,768 calls) | `contracts/test/` |
| Web | 301 passed / 1 skipped across 32 test files (302 total). Lighthouse accessibility 100 trên 5 trang (mobile) | `apps/web` |
| Guard SDK | 19/19 test pass (16 guard + 3 parity) | `packages/guard` |
| Python Benchmark | 14/14 unit tests pass trong `eval/agentdojo/test_provguard_pairs.py` | `eval/agentdojo` |
| On-chain Contracts Fuji | Địa chỉ Fuji hiện tại (`0x2045...`) là bản deploy cũ. Các bản vá mới (A1 root snapshot, A3 passkey governance) **CHƯA** deploy lên Fuji; đang chờ lệnh duyệt của Owner | `contracts/` |
| Passkey WebAuthn | Xác thực P-256 / DER / RP ID / Origin đã kiểm bằng unit tests và virtual authenticators (LOCAL_BROWSER_CRYPTO_BOUNDARY). Sinh trắc học phần cứng live trên Fuji ghi **NOT_RUN** | `apps/web`, `contracts/` |
| ICM Fuji ↔ Dispatch | Mới chạy với **mock local** (12 test). Chưa có giao dịch live | `contracts/test/MissionCrossChainICM.t.sol` |

## 2. Câu hỏi khó và câu trả lời

**"ProvGuard / NOMOS / SPILLWAY đã đạt khoảng 0% ASR rồi, các bạn hơn gì?"**
- Các guard đó chạy trên server của agent: server bị chiếm là mất hết. MissionPay để contract trên Avalanche quyết định, kèm bằng chứng Merkle của tập người nhận cho từng mission.
- Mình không nói ASR của mình tốt hơn họ. Trên replay AgentDojo, tỉ lệ chặn nhầm của mình bằng ProvGuard (3/16).
- Điểm mình đo được còn họ không đo: kẻ tấn công nằm sẵn trong allowlist chung mà contract vẫn chặn 150/150 (đây là config ii của replay trên fork).

**"Allowlist chung cũng chặn được người lạ rồi, mission set hơn gì?"**
- Đòn thật không dùng người lạ: nó trỏ tới một vendor công ty đã quen. Trên Fuji (13/11), cùng vendor trong allowlist chung: chế độ allowlist trả tiền, chế độ mission set revert `PayeeNotInMissionSet`, còn người nhận đúng vẫn được trả. Ba tx trong bảng mục 1.
- Lưu ý khi trả lời: "vendor bị lừa" trong demo là ví của chính đội (relayer), tiền 0,01 USDC testnet, đã gỡ khỏi allowlist sau demo. Treasury trên Fuji là bản deploy cũ (chưa có A1/A3); demo chỉ dùng logic có sẵn trong bản đó.

**"ENShell / Immunity (ETHGlobal 2026) cũng chặn agent bị prompt injection, khác gì?"**
- ENShell (top 10 ETHGlobal Cannes 2026) và Immunity (top 10 ETHGlobal New York 2026, cùng tác giả) cho một LLM (Claude chạy trong Chainlink CRE) chấm điểm rủi ro từng giao dịch, rồi approve, escalate hoặc block. Quyết định vẫn là phán đoán của một model.
- MissionPay không dùng LLM để quyết định: owner ký sẵn tập người nhận của mission (Merkle root), và contract trên Avalanche chỉ trả cho địa chỉ có trong tập đó. Một vendor quen nhưng không thuộc mission thì bị revert, bất kể nội dung nghe hợp lý đến đâu (Twin Treasury trên Fuji, 13/11).
- Không nói mình "tốt hơn" họ: hai cách bổ sung cho nhau, chấm rủi ro có thể đứng trước, contract là chốt cuối.
- Nguồn: ethglobal.com/showcase/enshell-6t95y, ethglobal.com/showcase/immunity-eg56a.

**"Sao vẫn lọt 8/128?"**
- Cả 8 đều do người dùng tự viết IBAN của kẻ tấn công vào prompt, bảo đó là chủ nhà mới. Guard không thể biết người dùng bị lừa từ trước. Ở đây owner phải ký duyệt tập người nhận của mission; lần ký đó là chỗ con người kiểm.

**"Owner có lách được không?"**
- Có, và lách công khai. Owner có thể đặt root của mission về 0 để quay lại chế độ allowlist chung. Thao tác này phát event `MissionPayeeRootSet` và tăng `policyVersion` on-chain. Có test hồi quy ghi lại đường này.
- Agent thì không làm được: agent chỉ đề xuất. Backend không giữ key của owner, còn relayer chỉ trả gas.

**"Cross-chain (ICM) chạy thật chưa?"**
- Chưa. Contract hub/gateway và script deploy đã fork-simulate trên RPC thật của Fuji và Dispatch. Việc gửi live cần faucet Dispatch và một relayer: trong 50k block gần nhất, mình kiểm không thấy relayer công khai nào giao tin Dispatch→Fuji. Phần này ghi là roadmap.

**"allowance-ai trên NEAR làm y hệt?"**
- Giống ở cap, allowlist, Face ID và arena.
- Khác ở chỗ: tập người nhận theo từng mission thay vì allowlist chung; kiểm provenance; x402 trên Avalanche có ràng request; proof được neo on-chain kèm ERC-8004 Validation.
- Bộ kiểm passkey của mình đã bổ sung kiểm tra exact RP ID, closed origin, UV/UP, DER canonical parser và P-256 normalization (A2), cùng với passkey governance đa hành động (A3). Ranh giới kiểm tự động là local browser virtual authenticator; hardware passkey trực tiếp trên Fuji chưa chạy.

**"AgentGuard402 cũng trên Fuji?"**
- Họ có allowlist chung cho cả tài khoản cộng cap. Không có mission, không có provenance, không neo proof, không có benchmark.

**"Freysa đã làm bounty từ 2024?"**
- Đúng, và Freysa mất tiền vì guard nằm trong prompt. Bounty của mình để contract quyết định, số liệu đọc thẳng từ chain.

## 3. Không được nói

- "SOTA", "đầu tiên", "duy nhất", hay "tốt hơn ProvGuard".
- "Live cross-chain".
- Bất kỳ số AgentDojo live nào trước khi Claude ghi vào bảng ở mục 1. Đặc biệt **không nói "0/48"**: số đó đo trên defense bị lỗi. Số live dùng được là 2/48 vs 31/48 (mục 1).
