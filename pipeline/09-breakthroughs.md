# 09 — Đột phá sáng tạo: làm thêm gì để khác biệt, theo thứ tự ưu tiên

**Định vị thẳng thắn (xem 10 §12):** các thành phần riêng đều đã
có tiền lệ — GateKeep cho x402 + ERC-8004 trên Fuji, AgentVault cho
guard pattern, Wallie cho pre-payment rails. Điểm khác biệt không
nằm ở việc phát minh thêm một component mới, mà nằm ở sự kết hợp
có thể kiểm chứng: **mission-scoped budget + receipt nối đủ mắt
xích + replay giải thích được vì sao một request auto/queue/block.**
Đừng claim "novel component" — claim "mission-scoped, auditable,
explainable" mới là đúng và kiểm chứng được.

**Chia core / stretch (sửa từ spec cũ):** proof bundle và mission
budget display không phải stretch — chúng là lớp bằng chứng của
chính use case đã chốt, thuộc S3. Chỉ các mục từ §3 trở đi mới là
stretch, làm khi S1–S3 đã xong (08 §4). Mỗi stretch phải có test
riêng và không được phá test cũ.

## 1. [CORE — S3] Proof bundle / receipt — làm trong S3, không phải stretch

**Ý tưởng:** mỗi lần thực thi thành công tạo ra 1 "gói bằng chứng"
nối đủ mắt xích: mission → policy decision → payment → result.

Gói gồm:

- Mission slug + missionId bytes32.
- Proposal JSON (đã validate) + hash của nó.
- Policy snapshot tại thời điểm đó: policy version, per-tx cap,
  daily cap, spent, queue reason nếu có.
- Tx hash payout hoặc tx hash tool payment.
- Result hash (hash của kết quả tool đã trả).
- Feedback ERC-8004 (nếu có, từ mission owner sau operation
  SETTLED) + tx hash feedback.
- Audit entry hash (nối vào hash chain, canonical encoding 04 §7).

UI hiển thị proof bundle dưới dạng 1 card: "Kiểm tra gói này" →
mở Snowtrace từng tx + verify hash bằng script độc lập. Giám khảo
không cần tin lời nói, chỉ cần click — nhưng kèm giới hạn ở 04 §7
(checkpoint, integrity không phải trustless).

## 2. [CORE — S3] Mission budget display + mission timeline

- Dashboard mission: mỗi mission hiển thị, **cho từng budget riêng**:
  treasury cap, spent, remaining, expiry; tool cap, spent, reserved,
  remaining, expiry; danh sách proposal/operation thuộc mission đó.
- Mission hết hạn tự động khóa (không propose thêm được, proposal
  cũ chưa chạy thì bị chặn ở execute bởi hard check, rồi expire
  theo 48h queue).
- Pitch: "quỹ không chỉ có giới hạn ngày, mà có giới hạn theo việc
  — một việc hỏng không kéo cả ngày xuống, và mọi khoản chi đều
  gắn với một nhiệm vụ cụ thể".

## 3. [STRETCH — S4] Replay dưới các policy khác nhau — simulation, không phải replay on-chain

- Cùng một proposal JSON + cùng snapshot mission, chạy validator
  với 3 policy variant (permissive / hiện tại / strict) và hiển thị
  route cho từng variant: auto / queue / block, kèm lý do.
- **Implement dưới dạng policy simulation off-chain, không submit
  tx.** Replay on-chain cùng một request sẽ double-spend hoặc tạo
  proposal trùng — bác bỏ implementation đó, giữ lại ý tưởng giải
  thích.
- Đây là stretch tạo khác biệt thật cho phần "explainable": giám
  khảo thấy vì sao cùng một request, đổi policy là đổi kết quả,
  mà không cần tin lời giải thích.

## 4. [STRETCH — S4] Attack replay — cho giám khảo tự bấm nút tấn công

- Trang `/demo/attack`: 3 nút tương ứng 3 đòn ở 06 §4. Giám khảo
  bấm nút → hệ thống chạy đòn tấn công thật (testnet, ví test) →
  hiển thị kết quả: naive mất bao nhiêu, guarded mất bao nhiêu tới
  attacker (kèm positive control).
- Khác với video quay sẵn: giám khảo tự tay thử, tin hơn nhiều.
- **An toàn:** chỉ chạy với ví test + tiền testnet nhỏ, nút có xác
  nhận "chỉ chạy trên Fuji testnet", không bao giờ chạy với ví chính.

## 5. [STRETCH — S4] Reputation-gated tool tier — làm cẩn thận, không làm ẩu

**Chỉ làm khi đã hiểu rõ giới hạn Sybil (03 §4).** Thiết kế an toàn:

- Tool seller có 2 tier: `standard` (ai cũng mua được) và `trusted`
  (chỉ agent/client có reputation từ trusted clients ≥ ngưỡng, ví
  dụ count ≥ 3 và summary ≥ 80, mới mua được).
- Tier không tăng cap, không mở allowlist, không tăng quyền quỹ —
  nó chỉ mở thêm tool cao cấp. Farm điểm để mua tool cao cấp thì
  thiệt hại tối đa là tiền tool, không phải tiền quỹ.
- Nếu không làm kịp logic trusted clients đúng chuẩn, **bỏ stretch
  này** — làm sai còn tệ hơn không làm, vì giám khảo sẽ hỏi về Sybil.

## 6. [STRETCH — S4] Rolling daily cap — thay ngày UTC bằng cửa sổ trượt 24h

- Thay `spentOnDay` bằng lịch sử payout (mảng timestamp + amount,
  hoặc bucket theo giờ) và tính tổng 24h gần nhất mỗi lần propose.
- Lợi: chống "đợi qua 0h UTC là lại có full cap" — kẽ hở của ngày UTC.
- Giá: code + test phức tạp hơn, demo khó giải thích hơn. Vì vậy
  đây là stretch, không phải MVP. Nếu làm, phải đổi cả 01, 04, 06,
  slides — không đổi 1 nơi rồi để nơi khác ghi ngày UTC.

## 7. [STRETCH — S4] Human-in-the-loop nâng cao — duyệt có điều kiện, không chỉ Approve/Reject

- Owner duyệt kèm điều kiện: "approve nhưng giảm amount xuống X"
  (tạo proposal mới với amount đã sửa, proposal cũ reject).
- Owner duyệt kèm ghi chú lý do, ghi chú đó vào audit + event.
- Batch approve? Không — duyệt từng cái là ý nghĩa của queue, batch
  làm mất kiểm soát. Đừng thêm batch approve cho tiện.

## 8. [STRETCH — S4] Multisig / timelock cho owner — stretch cuối cùng, chỉ khi còn thời gian

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
S3 core đã có: proof bundle (§1) + mission budget display (§2)
S4 stretch, theo thứ tự:
  → 3. Policy replay simulation (off-chain, không replay on-chain)
  → 4. Attack replay page
  → 5. Reputation tier (chỉ nếu làm đúng trusted clients)
  → 6. Rolling cap (chỉ nếu đổi hết docs kèm theo)
  → 7. Conditional approve
  → 8. Multisig/timelock
  → Dừng ở bất kỳ bước nào khi tới freeze 17/11.
```
