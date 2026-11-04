# 08 — Build plan theo ngày + chia việc + checklist cho GPT/Gemini

**Deadline: 21/11 23:59 VN. Freeze feature: 17/11. Khóa submission: 20/11.**

## 1. Lịch theo ngày — mỗi ngày có output kiểm tra được, không phải "đang làm"

| Ngày | Việc | Output kiểm tra được |
|---|---|---|
| 5/11 | S0 spike (nếu chưa xong): Fuji faucet, facilitator, ERC-8004 read/write | Tx hash 402→pay→200 + agentId, ghi vào README |
| 6/11 | S0 chốt: chọn facilitator cuối, chọn registry cuối, chốt hằng số 00 §8 | 1 facilitator + 1 registry set, không còn "đang thử 2 cái" |
| 7–9/11 | S1 Rails: tool server x402 + 3 tool + TalkMeter tick | Mua tool live, TalkMeter 2 phút có tx hash |
| 10–12/11 | S2 Guard: contract + test T1–T12 + queue UI + audit ledger | `forge test` pass T1–T12, queue approve/reject chạy |
| 13–14/11 | S2+S3 nối: proposer (LLM + scripted) + validator 12 luật + attack test | Attack 3 đòn có số trước/sau |
| 15–16/11 | S3 demo: ERC-8004 feedback + demo page 6 scene + polish UI | Demo page chạy đủ 6 scene, không crash |
| 17/11 | **FREEZE.** Chỉ sửa bug. Quay video lần 1 | Video draft 2:30 |
| 18–19/11 | Slides + README nộp bài + test ẩn danh mọi link | Slides + README xong, link mở được ẩn danh |
| 20/11 | **Khóa submission.** Submit sớm, chụp xác nhận | Submission đã Submit, không còn draft |
| 21/11 | Dự phòng: chỉ sửa link hỏng (nếu có) | Không thêm feature ngày này |

**Lưu ý lịch chồng:** MSLab report ~12/11, AgentX build 11–12/11 nếu
vào top 100, Zalo đã deprioritise (không aim nữa). Nếu tuần 11–12/11
quá tải, ưu tiên giữ S1 + S2 lõi, cắt stretch và cắt TalkMeter mở
rộng trước — đừng cắt guard để giữ TalkMeter.

## 2. Chia việc — 2 người làm được, 3 người thì nhanh hơn

| Người | Phụ trách | Không đụng vào |
|---|---|---|
| A — Contracts + test | `contracts/`, T1–T15, deploy, verify Snowtrace | UI chi tiết (chỉ cần API contract) |
| B — App + x402 + agent | `apps/web/`, validator, proposer, tool server, TalkMeter | Logic guard trong Solidity (chỉ gọi hàm đã định) |
| C — (nếu có người thứ 3) Demo + slides + ERC-8004 | Demo page, video, slides, feedback flow | Không đổi API/contract giữa chừng |

**Quy tắc phối hợp:**

- Hằng số 00 §8 là hợp đồng chung. Ai đổi hằng số phải báo cả team
  và cập nhật mọi file nhắc tới nó trong cùng ngày.
- Contract address chỉ có 1 (deploy 1 lần, dùng xuyên suốt). Deploy
  lại là phải cập nhật app, slides, video — tránh deploy lại sau 14/11.
- Mỗi ngày cuối ngày: push code lên branch riêng, merge vào main
  khi test của mình pass, không merge code đỏ.

## 3. Thứ tự implement cho Gemini — làm theo đúng thứ tự này

1. Đọc `00-overview.md` rồi `context/build-sources.md`.
2. Làm S0 spike trước, đừng viết UI trước khi có tx hash thật.
3. Làm contract theo `01` + test theo `06` §1, chạy `forge test`
   cho tới khi T1–T12 pass.
4. Làm tool server theo `02`, test x402 theo `06` §3.
5. Làm validator + proposer theo `04`, test injection theo `06` §2.
6. Làm app theo `05`, từng màn hình một: Dashboard → Queue → Audit → Demo.
7. Làm ERC-8004 feedback theo `03`, gắn vào sau mỗi tool call thành công.
8. Làm demo + video + slides theo `07`.
9. Chỉ sau đó mới đụng tới stretch ở `09`, theo thứ tự ưu tiên.

**Nếu Gemini bị kẹt ở bước nào > 4 giờ:** cắt scope của bước đó
theo 00 §6 (cắt stretch trước, cắt TalkMeter mở rộng sau, giữ guard
lõi + 1 tool live), ghi rõ đã cắt gì vào README, rồi đi tiếp. Đừng
kẹt 2 ngày ở 1 bước rồi mất cả pipeline.

## 4. Definition of Done — mỗi stage xong khi đủ tất cả, không phải "gần xong"

- **S0 xong:** tx hash 402→pay→200 + agentId + guard deploy được, ghi
  vào README.
- **S1 xong:** 3 tool mua live được, TalkMeter tick có tx, không
  mock trong flow chính.
- **S2 xong:** T1–T12 pass, queue approve/reject chạy, audit verify
  = true, attack 3 đòn có số.
- **S3 xong:** video 2:30 đúng 6 scene, slides 11 slide, submission
  checklist 07 §4 tick hết, link mở được ẩn danh.
- **S4 xong:** mỗi stretch có test riêng + không phá test cũ.

## 5. Checklist cho GPT review — gửi kèm khi nhờ GPT review

Nhờ GPT review đúng những điểm này, đừng nhờ review chung chung
"kiểm tra giúp":

- [ ] Contract có đường nào cho agent rút trực tiếp không? (Phải là không.)
- [ ] Validator có luật nào bị thiếu so với 12 luật ở 04 §3 không?
- [ ] Có chỗ nào dùng `approve(max)` hoặc mainnet address lẫn vào Fuji không?
- [ ] Daily cap ngày UTC có được nói đúng là ngày UTC ở mọi nơi không?
  (Không nơi nào ghi rolling nếu code không làm rolling.)
- [ ] Mock/simulated có ghi rõ ở mọi nơi dùng không?
- [ ] Reputation có bị dùng để tăng quyền tự động không? (MVP: không.)
- [ ] Mọi claim trong slides/video có trỏ tới test hoặc tx hash không?
- [ ] Có secret/key nào lọt vào repo không?

## 6. Rủi ro lớn nhất + cách xử lý đã chốt trước

| Rủi ro | Dấu hiệu | Xử lý |
|---|---|---|
| Facilitator down | Spike ngày 1 không ra tx | Đổi facilitator theo 02 §2 trong ngày, không chờ |
| LLM JSON sai liên tục | Validator reject > 50% | Chuyển sang scripted mode cho demo, LLM chỉ là phần mở rộng |
| Guard bug muộn | Test fail sau 14/11 | Cắt stretch, giữ guard lõi đã pass, không sửa kiến trúc sau freeze |
| Hết thời gian | Tới 17/11 mà S2 chưa xong | Nộp S1 (Rails + TalkMeter) — vẫn là bài nộp được, đừng nộp S2 dở dang |
| Link nộp bài hỏng | Ẩn danh mở không được | Sửa link trước 20/11, test lại ẩn danh, không đợi 21/11 |
