# 08 — Build plan theo ngày + chia việc + checklist cho GPT/Gemini

**Deadline: 21/11 23:59 VN. Freeze feature: 17/11. Khóa submission: 20/11.**

## 1. Lịch theo ngày — mỗi ngày có output kiểm tra được, không phải "đang làm"

| Ngày | Việc | Output kiểm tra được |
|---|---|---|
| 5/11 | S0 spike (nếu chưa xong): Fuji faucet, facilitator, ERC-8004 read/write | Tx hash 402→pay→200 + agentId, ghi vào README |
| 6/11 | S0 chốt: chọn facilitator cuối, chọn registry cuối, chốt hằng số 00 §8 | 1 facilitator + 1 registry set, không còn "đang thử 2 cái" |
| 7–9/11 | S1 Rails: tool server x402 + 3 tool + TalkMeter tick + mission record off-chain + **S1 submission pack** (README-S1, video draft scene 1/2/6, checklist 07 §4b) | Mua tool live, TalkMeter 2 phút có tx hash, S1 có thể nộp ngay nếu cắt ở đây |
| 10–12/11 | S2 Guard: contract (mission on-chain) + validator BLOCK/QUEUE + queue UI (MetaMask) + audit ledger (Postgres) | Test C/V pass, queue approve/reject chạy bằng MetaMask |
| 13–14/11 | S2+S3 nối: proposer (LLM + scripted) + mission token + attack test + positive control | Attack 3 đòn có số trước/sau cả hai bên |
| 15–16/11 | S3 bằng chứng + demo: ERC-8004 feedback từ mission owner + proof bundle + verifier script + demo page 6 scene + polish UI | Demo page chạy đủ 6 scene, không crash, feedback đọc lại được |
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
| A — Contracts + test | `contracts/`, test C-series, deploy, verify Snowtrace | UI chi tiết (chỉ cần API contract) |
| B — App + x402 + agent | `apps/web/`, validator, proposer, tool server, TalkMeter, mission token | Logic guard trong Solidity (chỉ gọi hàm đã định) |
| C — (nếu có người thứ 3) Demo + slides + ERC-8004 | Demo page, video, slides, feedback flow | Không đổi API/contract giữa chừng |

**Quy tắc phối hợp:**

- Hằng số 00 §8 là hợp đồng chung. Ai đổi hằng số phải báo cả team
  và cập nhật mọi file nhắc tới nó trong cùng ngày.
- Contract address chỉ có 1 (deploy 1 lần, dùng xuyên suốt). Deploy
  lại là phải cập nhật app, slides, video — tránh deploy lại sau 14/11.
- Mỗi ngày cuối ngày: push code lên branch riêng, merge vào main
  khi test của mình pass, không merge code đỏ.

## 3. Thứ tự implement cho Gemini — làm theo đúng thứ tự này (đồng bộ với stage ở §1)

1. Đọc `00-overview.md`, `10-review-response.md`, rồi
   `context/build-sources.md`. Đọc `11-gemini-handoff.md` trước khi code.
2. Làm S0 spike trước, đừng viết UI trước khi có tx hash thật.
   Ghi rõ facilitator + x402 version + scheme thực tế đã dùng.
3. **S1 trước:** làm tool server theo `02` (§3, §4, §9) + TalkMeter
   (§5, §9.5) + mission record off-chain + identity display.
   S1 auth/pause là off-chain theo `05` §4b — không dùng guard ở S1.
   Test V/L cho x402 + TalkMeter + operation idempotency + binding
   (V13–V21).
4. **S1 submission pack:** README-S1, video draft scene 1/2/6,
   checklist 07 §4b — để S1 có thể nộp ngay nếu phải cắt ở đây.
   S1 pack phải nói rõ S1 chưa có guard, pause là flag DB.
5. **S2 sau:** làm contract theo `01` (mission on-chain, state
   machine §6) + test C-series theo `06` §1, chạy `forge test`
   cho tới khi C-series pass. Sau đó làm cutover checklist `05` §4b
   (migrate mission, đặt guard pause khớp S1, chuyển PAUSE_SOURCE,
   kích hoạt lại token) trước khi chạy S2 tiếp.
6. Làm validator BLOCK/QUEUE + proposer (LLM + scripted) + mission
   token theo `04` và `05` §4a–§4b, test V-series theo `06` §2.
7. Làm app theo `05`, từng màn hình một: Dashboard (kèm mission
   card) → Queue (MetaMask) → Audit → Demo.
8. **S3:** làm ERC-8004 feedback từ mission owner theo `03`, gắn
   vào sau khi mission có operation SETTLED (không phải sau mỗi
   tool call), rồi làm proof bundle + verifier script theo `09` §1.
9. Làm demo + video + slides theo `07` (đủ 6 scene cho S2/S3, hoặc
   scene 1/2/6 cho S1).
10. Chỉ sau đó mới đụng tới stretch ở `09`, theo thứ tự ưu tiên ở đó.

**Nếu Gemini bị kẹt ở bước nào > 4 giờ:** cắt scope của bước đó
theo 00 §6 (cắt stretch trước, cắt TalkMeter mở rộng sau, giữ S1
hoặc guard lõi + 1 tool live tùy stage đang ở), ghi rõ đã cắt gì
vào README, rồi đi tiếp. Đừng kẹt 2 ngày ở 1 bước rồi mất cả pipeline.
Đặc biệt: không làm contract trước tool server — đó là lỗi thứ tự
của spec cũ, đã sửa ở đây.

## 4. Definition of Done — mỗi stage xong khi đủ tất cả, không phải "gần xong"

- **S0 xong:** tx hash 402→pay→200 + agentId + facilitator/x402
  version thực tế, ghi vào README.
- **S1 xong:** 3 tool mua live được, TalkMeter tick có tx,
  operation idempotency + binding + reservation atomic + UNKNOWN
  recovery + restart persistence pass (V13–V21), mission record
  off-chain có, S1 auth/pause off-chain đúng §4b, S1 submission pack
  xong, không mock trong flow chính. Không tick test nào chưa chạy.
- **S2 xong:** C-series + V-series pass, cutover checklist 05 §4b
  xong, queue approve/reject chạy bằng MetaMask, audit verify = true
  (API + script độc lập), attack 3 đòn có số trước/sau + positive control.
- **S3 xong:** video 2:30 đúng 6 scene, slides 12 slide, proof bundle
  + verifier script, submission checklist 07 §4c tick hết, link mở
  được ẩn danh.
- **S4 xong:** mỗi stretch có test riêng + không phá test cũ.

## 5. Checklist cho GPT review — gửi kèm khi nhờ GPT review

Nhờ GPT review đúng những điểm này, đừng nhờ review chung chung
"kiểm tra giúp":

- [ ] Contract có đường nào cho agent rút trực tiếp không? (Phải là không.)
- [ ] Validator có đủ BLOCK check trước QUEUE check ở 04 §3 không?
  Schema có check cap không? (Phải là không — cap là policy.)
- [ ] Mission có bắt buộc tồn tại, chưa hết hạn, đúng agent không?
  LLM có tự tạo mission được không? (Phải là không.)
- [ ] Approve/execute sau expiry, execute lặp, recipient bị gỡ sau
  queue, policy đổi giữa propose và execute đã xử lý đúng 01 §6 chưa?
- [ ] Tool payment có queue không? (MVP: không.)
- [ ] Operation idempotency, reservation atomic, UNKNOWN recovery
  (nonce chưa dùng ≠ FAILED, nonce đã dùng ≠ SETTLED), TalkMeter
  unique tick, operation binding (mission/payer/tool/input/payment
  terms), recovery endpoint có quyền đã đúng 02 §9 chưa?
- [ ] S1 auth/pause có dùng guard không? (Phải là không — S1 là
  off-chain, cutover checklist 05 §4b đã làm chưa?)
- [ ] LLM compromise và key compromise có bị gộp không? (Phải tách —
  toolCap off-chain không enforce với key holder, tổn thất tool tính
  theo số dư ví tool.)
- [ ] ERC-8004 ABI đúng chưa: getSummary 4 tham số, readFeedback/
  readAllFeedback (không phải getFeedback), feedback client là
  mission owner, feedback chỉ sau operation SETTLED?
- [ ] Storage deploy đúng chưa: Vercel + hosted Postgres, không phải
  SQLite local?
- [ ] Có chỗ nào dùng `approve(max)` hoặc mainnet address lẫn vào Fuji không?
- [ ] Daily cap ngày UTC có được nói đúng là ngày UTC ở mọi nơi không?
  (Không nơi nào ghi rolling nếu code không làm rolling.)
- [ ] Mock/simulated có ghi rõ ở mọi nơi dùng không?
- [ ] Reputation có bị dùng để tăng quyền tự động không? (MVP: không.)
- [ ] Mọi claim trong slides/video có trỏ tới test hoặc tx hash không?
- [ ] Có secret/key/mission token nào lọt vào repo không?

## 6. Rủi ro lớn nhất + cách xử lý đã chốt trước

| Rủi ro | Dấu hiệu | Xử lý |
|---|---|---|
| Facilitator down | Spike ngày 1 không ra tx | Đổi facilitator theo 02 §2 trong ngày, không chờ |
| LLM JSON sai liên tục | Validator reject > 50% | Chuyển sang scripted mode cho demo, LLM chỉ là phần mở rộng |
| Guard bug muộn | Test fail sau 14/11 | Cắt stretch, giữ guard lõi đã pass, không sửa kiến trúc sau freeze |
| Hết thời gian | Tới 17/11 mà S2 chưa xong | Nộp S1 (Rails + TalkMeter) — vẫn là bài nộp được, đừng nộp S2 dở dang |
| Link nộp bài hỏng | Ẩn danh mở không được | Sửa link trước 20/11, test lại ẩn danh, không đợi 21/11 |
