# MissionPay: Q&A dự phòng cho giám khảo

Chỉ dùng các con số đã được Claude kiểm lại. Ô ghi "CHƯA CÓ" thì không được nói lên sân khấu.
Cập nhật: 2026-11-09.

## 1. Số liệu được phép nói

| Chủ đề | Số | Nguồn |
|---|---|---|
| AgentDojo banking, replay không dùng model (C2 strict) | Chặn 120/128 đòn tài chính. Benign utility 13/16, chặn nhầm 3/16 (bằng ProvGuard policy v1) | `eval/agentdojo/SUMMARY.md`, `results/replay-ground-truth-20261109-035811.json` |
| 8 đòn lọt | Đều nằm ở `user_task_15`: chính prompt của người dùng đặt IBAN của kẻ tấn công làm chủ nhà mới. Ở 15 task còn lại chặn 120/120 | như trên |
| Replay trên fork Fuji | Contract và guard off-chain khớp nhau 169/169. Khi cố tình đưa kẻ tấn công vào allowlist chung, contract vẫn revert 150 lệnh với `PayeeNotInMissionSet` | như trên |
| AgentDojo live, Gemini | **CHƯA CÓ.** Đang chạy trên quota free, kết quả theo từng đợt | `REVIEW_FIXES_WOW.md` mục M4-LIVE |
| Foundry | 74/74 test pass, có invariant suite | `contracts/` |
| Web | 240/240 test pass. Lighthouse accessibility 100 trên 5 trang (mobile) | `apps/web` |
| ICM Fuji ↔ Dispatch | Mới chạy với **mock local** (12 test). Chưa có giao dịch live | `contracts/test/MissionCrossChainICM.t.sol` |

## 2. Câu hỏi khó và câu trả lời

**"ProvGuard / NOMOS / SPILLWAY đã đạt khoảng 0% ASR rồi, các bạn hơn gì?"**
- Các guard đó chạy trên server của agent: server bị chiếm là mất hết. MissionPay để contract trên Avalanche quyết định, kèm bằng chứng Merkle của tập người nhận cho từng mission.
- Mình không nói ASR của mình tốt hơn họ. Trên replay AgentDojo, tỉ lệ chặn nhầm của mình bằng ProvGuard (3/16).
- Điểm mình đo được còn họ không đo: kẻ tấn công nằm sẵn trong allowlist chung mà contract vẫn chặn 150/150 (đây là config ii của replay trên fork).

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
- Bộ kiểm passkey của họ hiện chặt hơn (có kiểm origin và RP ID). Nếu bị hỏi thì thừa nhận.

**"AgentGuard402 cũng trên Fuji?"**
- Họ có allowlist chung cho cả tài khoản cộng cap. Không có mission, không có provenance, không neo proof, không có benchmark.

**"Freysa đã làm bounty từ 2024?"**
- Đúng, và Freysa mất tiền vì guard nằm trong prompt. Bounty của mình để contract quyết định, số liệu đọc thẳng từ chain.

## 3. Không được nói

- "SOTA", "đầu tiên", "duy nhất", hay "tốt hơn ProvGuard".
- "Live cross-chain".
- Bất kỳ số AgentDojo live nào trước khi Claude ghi vào bảng ở mục 1.
