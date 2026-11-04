# 09 — Đột phá sáng tạo: làm thêm gì để khác biệt, theo thứ tự ưu tiên

**Quy tắc:** chỉ làm stretch khi S1–S3 đã xong (08 §4). Mỗi stretch
phải có test riêng và không được phá test cũ. Làm theo thứ tự 1 → 7,
không nhảy cóc tới stretch khó trong khi stretch dễ chưa xong.

## 1. Proof bundle — nên làm đầu tiên (dễ, khoe mạnh)

**Ý tưởng:** mỗi lần thực thi thành công tạo ra 1 "gói bằng chứng"
mà ai cũng kiểm tra được, không cần tin team.

Gói gồm:

- Proposal JSON (đã validate) + hash của nó.
- Policy snapshot tại thời điểm đó (per-tx cap, daily cap, spent).
- Tx hash payout hoặc tx hash tool payment.
- Feedback ERC-8004 (nếu có) + tx hash feedback.
- Audit entry hash (nối vào hash chain).

UI hiển thị proof bundle dưới dạng 1 card: "Kiểm tra gói này" →
mở Snowtrace từng tx + verify hash. Giám khảo không cần tin lời
nói, chỉ cần click.

**Vì sao khác biệt:** hầu hết bài hackathon chỉ khoe "nó chạy",
không khoe "nó chạy và bạn kiểm tra được từng bước".

## 2. Mission envelope + mission timeline — đã có lõi ở 04 §5, làm rõ thêm

- Dashboard mission: mỗi mission hiển thị cap, đã chi, còn lại,
  hết hạn khi nào, danh sách proposal thuộc mission đó.
- Mission hết hạn tự động khóa (không propose thêm được, proposal
  cũ chưa chạy thì expire theo 48h queue).
- Pitch: "quỹ không chỉ có giới hạn ngày, mà có giới hạn theo việc
  — một việc hỏng không kéo cả ngày xuống".

## 3. Attack replay — cho giám khảo tự bấm nút tấn công

- Trang `/demo/attack`: 3 nút tương ứng 3 đòn ở 06 §2. Giám khảo
  bấm nút → hệ thống chạy đòn tấn công thật (testnet, ví test) →
  hiển thị kết quả: naive mất bao nhiêu, guarded mất 0.
- Khác với video quay sẵn: giám khảo tự tay thử, tin hơn nhiều.
- **An toàn:** chỉ chạy với ví test + tiền testnet nhỏ, nút có xác
  nhận "chỉ chạy trên Fuji testnet", không bao giờ chạy với ví chính.

## 4. Reputation-gated tool tier — làm cẩn thận, không làm ẩu

**Chỉ làm khi đã hiểu rõ giới hạn Sybil (03 §4).** Thiết kế an toàn:

- Tool seller có 2 tier: `standard` (ai cũng mua được) và `trusted`
  (chỉ agent/client có reputation từ trusted clients ≥ ngưỡng, ví
  dụ count ≥ 3 và summary ≥ 80, mới mua được).
- Tier không tăng cap, không mở allowlist, không tăng quyền quỹ —
  nó chỉ mở thêm tool cao cấp. Farm điểm để mua tool cao cấp thì
  thiệt hại tối đa là tiền tool, không phải tiền quỹ.
- Nếu không làm kịp logic trusted clients đúng chuẩn, **bỏ stretch
  này** — làm sai còn tệ hơn không làm, vì giám khảo sẽ hỏi về Sybil.

## 5. Rolling daily cap — thay ngày UTC bằng cửa sổ trượt 24h

- Thay `spentOnDay` bằng lịch sử payout (mảng timestamp + amount,
  hoặc bucket theo giờ) và tính tổng 24h gần nhất mỗi lần propose.
- Lợi: chống "đợi qua 0h UTC là lại có full cap" — kẽ hở của ngày UTC.
- Giá: code + test phức tạp hơn, demo khó giải thích hơn. Vì vậy
  đây là stretch, không phải MVP. Nếu làm, phải đổi cả 01, 04, 06,
  slides — không đổi 1 nơi rồi để nơi khác ghi ngày UTC.

## 6. Human-in-the-loop nâng cao — duyệt có điều kiện, không chỉ Approve/Reject

- Owner duyệt kèm điều kiện: "approve nhưng giảm amount xuống X"
  (tạo proposal mới với amount đã sửa, proposal cũ reject).
- Owner duyệt kèm ghi chú lý do, ghi chú đó vào audit + event.
- Batch approve? Không — duyệt từng cái là ý nghĩa của queue, batch
  làm mất kiểm soát. Đừng thêm batch approve cho tiện.

## 7. Multisig / timelock cho owner — stretch cuối cùng, chỉ khi còn thời gian

- Thay owner đơn bằng multisig 2/3 hoặc timelock 24h cho đổi policy
  (đổi cap phải chờ 24h mới có hiệu lực, trong thời gian chờ ai
  cũng thấy).
- Lợi: chống owner key bị lộ đổi policy ngay lập tức.
- Giá: deploy + test + UI phức tạp, demo dài hơn. Chỉ làm nếu S1–S3
  + stretch 1–4 đã xong và còn ≥ 3 ngày.

## Những thứ KHÔNG làm — dù nghe hay, vì phá scope hoặc phản pitch

| Đừng làm | Vì sao |
|---|---|
| Phát hành token riêng cho sản phẩm | Hackathon chấm agent economy + guard, không chấm tokenomics; token làm loãng câu chuyện và thêm rủi ro pháp lý/giá |
| Lending / yield cho quỹ nhàn rỗi | Quỹ demo mà đem đi yield là tự tạo rủi ro, phản lại pitch "giữ tiền an toàn" |
| AI tự đổi policy theo thị trường | Policy đổi bằng AI là bỏ guard — đúng cái sản phẩm chống lại |
| Full meeting app (mic, transcription, participant) | TalkMeter đã đủ; meeting app đầy đủ là sản phẩm khác, nuốt hết thời gian |
| Validation registry đầy đủ | Ngoài scope MVP, cần thiết kế oracle/auditor riêng — để roadmap, không làm vội |
| Auto-approve theo thời gian | Queue tự approve là bỏ human-in-the-loop |
| Cross-chain / mainnet | Deadline + testnet-only là lựa chọn an toàn; mainnet là rủi ro không cần thiết |

## Tóm tắt thứ tự cho Gemini

```
S1–S3 xong
  → 1. Proof bundle
  → 2. Mission timeline UI
  → 3. Attack replay page
  → 4. Reputation tier (chỉ nếu làm đúng trusted clients)
  → 5. Rolling cap (chỉ nếu đổi hết docs kèm theo)
  → 6. Conditional approve
  → 7. Multisig/timelock
  → Dừng ở bất kỳ bước nào khi tới freeze 17/11.
```
