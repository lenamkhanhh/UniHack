# MissionPay: rà soát SOTA và kế hoạch tối đa điểm (07/11/2026)

Người viết: reviewer (Claude). Gemini chỉ implement theo spec sẽ giao ở `REVIEW_PROMPT_GPT.md`.

Căn cứ:
- Rubric: Tech 25, Avalanche 25, Creativity 15, Impact 15, Pitch 10, UI/UX 10.
- Trạng thái repo tại `516c423`: vòng PROVENANCE đã đóng.
- Research ngày 07/11. Nguồn ở mục 7.

## 0. Kết luận thẳng

1. **Ý tưởng lõi đúng hướng SOTA và có bằng chứng mới đỡ lưng.**
   - Nghiên cứu 2026 cho thấy loại đòn nguy hiểm nhất không còn là cài lệnh mà là **cài dữ liệu** (agent data injection, ADI).
     - Prompt Guard 2 không bắt được 0/108 đòn ADI.
     - CaMeL vẫn để lọt 23%. Progent để lọt 22%.
   - Chính paper ADI cũng viết: chỉ policy chi tiết ở điểm hành động mới chặn được. Cái khó là viết được policy đó.
   - Với thanh toán, policy này rẻ: **owner vốn đã biết mình trả cho ai**. MissionPay khóa danh sách đó bằng Merkle root trên Avalanche.
   - Đây là câu chuyện "wow" có học thuật đỡ lưng. Hiện deck chưa kể câu chuyện này.
2. **Điểm đang mất nhiều nhất là Avalanche (25).** Mọi thứ vẫn ở chế độ MOCK. Fuji live vẫn là việc số 1, và đang chờ owner nạp faucet.
3. **Tech (25) thiếu hai thứ mà giám khảo đọc code sẽ hỏi:**
   - Agent có dùng LLM thật không (chưa có `GEMINI_API_KEY`).
   - Có số đo nào không (chưa có eval).
   SOTA năm 2026 luôn báo cáo **ASR và utility** cùng nhau. Mình chưa có cả hai.
4. **Có ba nâng cấp rẻ nhưng rất "SOTA"** mà đối thủ trong cuộc thi gần như chắc chắn không có:
   - Vá x402 theo paper ATC'26.
   - ERC-8004 Validation bằng boilerplate của chính Ava Labs.
   - Số dư ví đọc live từ Fuji ngay trên màn hình arena.

## 1. SOTA hiện tại và MissionPay đứng ở đâu

| Mảng | SOTA (2026) | MissionPay hiện tại | Khoảng cách |
|---|---|---|---|
| Phòng prompt injection | Thực thi ngoài model: CaMeL, FIDES, Progent (AgentDojo ASR 39.9% → 1.0%). | Validator nằm ngoài LLM, có provenance cho từng tham số thanh toán. | Đúng hướng. **Chưa có số đo.** |
| Agent data injection (SNU/UIUC, 07/2026) | ADI lọt 22–50% qua mọi defense. CaMeL Strict về ~0% nhưng mất utility. | Tập payee owner đã ký + root on-chain = policy "strict" tại điểm chi tiền, chi phí viết policy gần bằng 0. | **Chưa đo ADI.** Đây là cơ hội lớn nhất cho mục Creativity. |
| Benchmark thanh toán | APort Vault (09/2026): 4,371 đòn, 14 model, 0/69,297 lọt qua lớp kiểm off-chain. AIP-Bench, AP2-WhisperBench. | Có template sự cố, không có dataset. | Cần subset APort + ADI, chạy với LLM thật. |
| Bảo mật x402 (ATC'26) | Tìm ra 4 lớp lỗ: F1 thanh toán cho tài nguyên khác, F2 settle trùng, F3 overdraft khi dùng `upto`, F4 giao kết quả trước khi settle. | F2: unique `(chainId, asset, from, nonce)`. F4: giữ kết quả tới khi `SETTLED`. F1: binding ở tầng app, nonce ngẫu nhiên. F3: không dùng `upto`. | Thêm F1 bằng mật mã: nonce EIP-3009 = hash của request. |
| x402 phiên bản | v2 (12/2025): header `PAYMENT-SIGNATURE`, CAIP-2 `eip155:43113`. Avalanche Academy và PayAI dùng v2. | v1 (`X-PAYMENT`, `avalanche-fuji`). | Lên v2 có fallback v1 (P2, làm sau khi Fuji chạy). |
| ERC-8004 | Identity và Reputation có trên Fuji. Validation chưa có bản chính thức; Ava Labs có `8004-boilerplate` deploy được trên Fuji. | Identity + feedback Reputation. | Thêm **Validation**, trả lời đúng vấn đề mở "verifiable execution" mà blog Team1 nêu. |
| Câu chuyện của BTC | Blog Team1 (07/2026): MCP/A2A → ERC-8004 → x402 → **legibility layer**. Vấn đề còn mở: verifiable execution, dispute, privacy. | Trang /verify, audit hash chain, proof neo chain. | Pitch chưa dùng ngôn ngữ của BTC. |

## 2. Nâng cấp đề xuất, xếp theo điểm thu được trên công sức

| # | Việc | Tiêu chí ăn điểm | Ai làm / phụ thuộc | Công sức |
|---|---|---|---|---|
| **S1** | **Fuji live end-to-end** (đã lên kế hoạch): deploy contract mới, `setMissionPayeeRoot` bằng MetaMask, x402 thật, giao dịch revert `PayeeNotInMissionSet` thật, neo proof. | Avalanche +8–10, Tech +2 | Owner nạp faucet và duyệt broadcast → Gemini | Trung bình |
| **S2** | **Eval "PayBench-ADI"** với LLM thật. 3 họ đòn: (a) subset APort Vault (kiểm licence dataset trước); (b) **ADI chèn delimiter vào trường người nhận và số tiền** theo kỹ thuật của paper SNU; (c) Bankr, Zscaler, Cornell. 3 cấu hình: không guard / validator không có provenance / MissionPay đầy đủ. Báo **ASR (tiền tới payee không được phép)** và **utility (payout hợp lệ hoàn thành)**. Kèm vài tx revert trên Fuji. Ra `ATTACK_EVAL.md` và một slide. | Tech +2, Creativity +2, Impact +2 | Cần `GEMINI_API_KEY` → Gemini | Trung bình |
| **S3** | **Vá x402 theo ATC'26.** Nonce EIP-3009 = `keccak256(operationId, H(method‖URI‖body), quoteHash)`, seller tính lại và so khớp (F1). Test cho F1, F2, F4. Thêm bảng tự kiểm 4 lớp lỗ vào README. | Tech +1–2 | Gemini, không phụ thuộc gì | Thấp |
| **S4** | **ERC-8004 Validation:** deploy `ValidationRegistry` từ `ava-labs/8004-boilerplate` lên Fuji. Khi đóng mission: `validationRequest`/`validationResponse` với `requestHash` = audit head đã neo, `response` = 100 nếu tiền ra ngoài phạm vi = 0, `responseURI` = link /verify. | Avalanche +1–2, Creativity +1 | Sau S1 | Thấp–trung bình |
| **S5** | **Arena on-chain:** màn Stage hiện số dư USDC của ví mission đọc live từ Fuji, link Snowtrace, dòng "không đổi sau N đòn", và tx revert gần nhất. | UI/UX +1, Avalanche +1, wow | Sau S1 | Thấp |
| **S6** | **Pitch theo SOTA** (reviewer làm): thêm slide "Đòn mới cài *dữ liệu*, không cài *lệnh*" (0/108, 23%). Câu chốt: "Với thanh toán, policy chặt là miễn phí: owner đã biết mình trả cho ai, và Avalanche thực thi nó." Gọi MissionPay là "legibility + firewall layer" theo đúng từ của blog Team1. Bổ sung Q&A: Rule of Two, CaMeL, APort, AP2 whisper. | Pitch +2, Creativity +1, Impact +1 | Reviewer | Thấp |
| S7 | x402 v2 (`PAYMENT-SIGNATURE`, CAIP-2) có fallback v1. Kiểm `/supported` của PayAI và Ultravioleta trước. | Avalanche +0.5–1 | Chỉ làm sau S1, và chỉ khi còn ≥ 3 ngày | Trung bình, có rủi ro |
| Roadmap | eERC (trả lương riêng tư; đã có CloakX402 làm), ngân sách xuyên L1 qua ICM, x402 `auth-capture` để hoàn tiền. | Chỉ ghi trên slide roadmap | — | — |

**Không làm:** viết lại agent framework, thêm chain khác, hay giành mảng privacy với CloakX402 hoặc Benzo.

## 3. Điểm dự kiến

| Tiêu chí | Max | Hiện tại (MOCK, chưa có eval) | + S1 | + S1–S6 |
|---|---|---|---|---|
| Technical | 25 | 18–20 | 20–21 | 22–24 |
| Avalanche | 25 | 9–12 | 18–20 | 21–23 |
| Creativity | 15 | 11–12 | 11–12 | 13–14 |
| Impact | 15 | 10–11 | 11 | 12–14 |
| Pitching | 10 | 6–7 | 7 | 8–9 |
| UI/UX & Demo | 10 | 7–8 | 8 | 8–9 |
| **Tổng** | 100 | **61–70** | **75–79** | **84–93** |

**Xác suất (phán đoán):**
- Top 10: khoảng 85% nếu xong S1–S6.
- Top 3: khoảng 45–55% nếu xong S1–S6.
- Nếu không có Fuji live, Top 3 chỉ còn khoảng 15–20%.

## 4. Lịch (deadline nộp 20/11)

| Ngày | Việc |
|---|---|
| 07–08/11 | S3 (Gemini) và S6 bản nháp (reviewer). Owner nạp faucet và tạo `GEMINI_API_KEY`. |
| 09–11/11 | S1 Fuji live. |
| 11–12/11 | S4 và S5. |
| 12–14/11 | S2 eval, rồi chốt slide số liệu. |
| 14–16/11 | Deploy public (owner duyệt), quay video 2:30. |
| 17–18/11 | Freeze code, tập pitch và Q&A. |
| 19–20/11 | Nộp bài. |

**Cổng chất lượng trước khi nộp:**
- Mọi số trên slide phải có link tx hoặc file eval tương ứng.
- Mọi dữ liệu MOCK phải được gắn nhãn.

## 5. Câu pitch đề xuất (dùng trong slide 3 và video)

> "Năm 2026 kẻ tấn công không còn ra lệnh cho agent. Chúng cài một địa chỉ ví vào dữ liệu agent đọc. Prompt Guard bắt được 0 trên 108 đòn kiểu này. Cách duy nhất chặn được là một policy chặt ở đúng chỗ tiền đi ra. Với thanh toán, policy đó gần như miễn phí, vì owner vốn đã biết mình trả cho ai. MissionPay khóa danh sách ấy trên Avalanche, nên một trang web không thể cài người nhận vào. Và ai cũng tự kiểm được biên lai."

## 6. Q&A bổ sung

- **"Khác gì CaMeL hay Progent?"** Đó là nghiên cứu chung cho mọi tool, và vẫn để lọt 22–23% đòn ADI. Mình chuyên cho thanh toán: policy là tập payee owner ký, được thực thi on-chain, nên kể cả server bị chiếm cũng không chi được.
- **"APort Vault đã đạt 0 vi phạm rồi?"** Đúng, nhưng đó là lớp kiểm off-chain. Paper của họ cũng tự ghi là thiếu đòn kiểu fuzz tham số. Mình thêm đòn ADI vào tham số và neo kết quả on-chain.
- **"Meta Rule of Two?"** Agent đọc dữ liệu không tin cậy và có quyền chi tiền thì phải có người duyệt. MissionPay biến lần duyệt đó thành một chữ ký owner cho cả mission, thay vì duyệt từng giao dịch.
- **"AP2 cũng có mandate ký?"** Paper whisper (09/2026) cho thấy AP2 ký giao dịch nhưng không ký quyết định: tới 90% đòn thành công. Mình gắn nguồn gốc vào chính tham số quyết định (người nhận, số tiền).

## 7. Nguồn

- [Agent Data Injection Attacks are Realistic Threats to AI Agents, arXiv 2607.05120](https://arxiv.org/abs/2607.05120) (SNU/UIUC, 07/2026; Prompt Guard 2 bắt 0/108; CaMeL 23.1%; Progent 22.2%)
- [Adaptive Evaluation of Out-of-Band Defenses, arXiv 2606.26479](https://arxiv.org/html/2606.26479v1)
- [CaMeL: Defeating Prompt Injections by Design](https://www.researchgate.net/publication/390176637_Defeating_Prompt_Injections_by_Design)
- [MELON](https://arxiv.org/pdf/2502.05174), [AgentArmor](https://arxiv.org/pdf/2508.01249)
- [Free-Riding the Agentic Web: x402 security analysis, ATC'26, arXiv 2605.30998](https://arxiv.org/abs/2605.30998)
- [APort Vault benchmark, arXiv 2609.22076](https://arxiv.org/abs/2609.22076) và [dataset](https://huggingface.co/datasets/aporthq/vault-benchmark-v1)
- [Whisper Attacks on AP2, arXiv 2609.11757](https://arxiv.org/abs/2609.11757)
- [AIP-Bench, arXiv 2607.21824](https://arxiv.org/abs/2607.21824), [Agentic Commerce Bench, arXiv 2609.35886](https://arxiv.org/abs/2609.35886), [SoK Agentic Commerce, arXiv 2604.15367](https://arxiv.org/pdf/2604.15367)
- [Team1 blog: Agentic Payments on Avalanche: The Layer After Trust](https://www.team1.blog/p/agentic-payments-on-avalanche-the) (07/2026)
- [Team1 blog: ERC-8004 Agent Identity on Avalanche](https://www.team1.blog/p/erc-8004-agent-identity-on-avalanche) (05/2026)
- [erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts), [ava-labs/8004-boilerplate](https://github.com/ava-labs/8004-boilerplate)
- [x402 V2 launch](https://x402.org/x402-v2-launch/), [Avalanche Academy: x402 facilitators](https://build.avax.network/academy/blockchain/x402-payment-infrastructure/04-x402-on-avalanche/03-facilitators), [PayAI quickstart](https://docs.payai.network/x402/quickstart)
- [CloakX402 (eERC + x402, Team1 India)](https://github.com/Allen-Saji/cloakx402)
- [Avalanche October 2026 recap](https://www.team1.blog/p/avalanche-october-2026-recap), [August 2026 recap](https://www.team1.blog/p/avalanche-august-2026-recap) (Agentic Payments Alliance)
