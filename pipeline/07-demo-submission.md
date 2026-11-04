# 07 — Demo và submission

## 1. Demo đầy đủ S2/S3: 6 scene, 2:30

Use case xuyên suốt: nhóm giao research brief, agent tìm nguồn và tóm tắt; payout cho người cộng tác là khoản riêng.
Quay actual app/receipts; có thể edit thời gian chờ và dùng session đã chạy trước nếu ghi rõ recorded live run.
Không speed-up timer rồi nói đã đủ billable minute thật.

| Scene | Giây | Hành động / evidence |
|---|---:|---|
| 1 Mission | 20 | Người giao, deliverable, expiry, hai budget; agent identity nếu đã live |
| 2 Paid result | 30 | Search → summary, quote/payment/result, một receipt click được và result hash |
| 3 Treasury auto | 20 | 5 USDC payout cho cộng tác viên allowlisted, propose auto executes, actual spent |
| 4 Human exception | 30 | 6 USDC queue → O approve rồi execute, override tag và ba receipts |
| 5 Containment | 30 | Một injected/lookalike proposal bị chặn, sau đó valid positive control; before/after |
| 6 Recovery + control | 20 | Pause chặn spend mới; owner vẫn đọc/reconcile payment cũ, không trả tiền lại |

Scene 3+4 chi 11 USDC nên mission treasury cap 10 bị override 1 USDC: show overBy có chủ ý.
Positive control có thể là tool purchase còn budget, không phải treasury auto sau mission đã over cap.
Không reset missionSpent để quay lại scene; tạo mission mới cho rehearsal có record mới.
TalkMeter live hai phút để ở supporting clip/demo riêng, không cố đợi đủ hai phút trong video chính.

## 2. Nếu nộp S1

Video 2–3 phút: mission off-chain → paid research result → TalkMeter receipts từ session thật →
pause DB và recovery sau expiry → budget/audit export.
Không đưa guard/queue/reputation feedback chưa implement vào demo như đã chạy.
Badge S1, SCRIPTED/LIVE_LLM, LIVE_FUJI/MOCK đúng mode; identity chỉ claim nếu có actual registry read.
Read-only public demo dùng receipt/result đã sanitize; nút live spending chỉ owner authorize,
không mở agent signer cho khách dùng arbitrary input.

## 3. Slides: 12 slide cho S2/S3

1. Title + mission use case.
2. Ai cần sản phẩm, task cụ thể và deliverable.
3. Authority: LLM proposes, code validates, treasury guard enforces, O approves.
4. Hai đường tiền và hai budget, S1 vs S2.
5. x402 purchase → result và receipt đúng nonce.
6. Treasury auto/queue/override, source verified.
7. Budget spent/reserved/remaining/expiry và UNKNOWN recovery.
8. Proof bundle → checkpoint/verifier, giới hạn evidence.
9. Attack đối chứng + positive control, phạm vi LLM/key khác nhau.
10. Identity/quality feedback từ O sau deliverable (nếu implemented).
11. Giới hạn/optional roadmap, không dự báo điểm.
12. Links repo/app/video/slides/receipt manifest.

S1 deck vẫn đủ câu chuyện bằng cùng outline, thay các slide guard/feedback bằng evidence S1:
abandoned reservation cleanup, retry/restart recovery và TalkMeter. Không giữ slide feature chưa xây.

## 4. Checklist trước submit

- [ ] Repo public hoặc private + organizer GitHub user tuantqse90 truy cập được.
- [ ] README mô tả đúng release stage và actual commands/limitations.
- [ ] App link không cần tài khoản team để đọc curated demo; owner auth không bị vô hiệu để cho judges thử.
- [ ] Slides và video 2–3 phút mở được bằng anonymous browser.
- [ ] Evidence manifest chứa chain/token/facilitator/protocol/ABIs/finality + tx hashes thực tế.
- [ ] P/V/E required stage test results thật; S2 thêm C/L3, S3 thêm registry/proof.
- [ ] Public export không secret/signature/token/private mission result.
- [ ] Nếu S1 fallback: dùng passing S1 tag, claims không guard/human queue/feedback giả.
- [ ] Nếu S2/S3: guard source verified, attack before/after và positive control, checkpoint/verifier.
- [ ] Bấm Submit, không chỉ Save draft; lưu confirmation sau hành động thực tế.

Planning deadline 21/11/2026 23:59 VN; internal submit 20/11.
Theo research snapshot, Team1 và Builder Hub khác deadline/venue/submission route.
Dùng [competition context](../context/competition-context.md) để xác nhận organizer instructions gần ngày nộp;
không tự giả định phải submit cả hai hay dùng ngày muộn hơn. Lượt sửa spec này chưa submit bất kỳ form nào.

## 5. Evidence theo rubric

Technical: code + P/V/C đúng stage. Avalanche: Fuji receipts, verified source, pinned ABIs.
Creativity: mission-linked result/payment proof; optional replay chỉ claim khi đã làm.
Impact: nhóm nhận research brief thực tế. Presentation: video có luồng công việc.
UI/UX: owner hiểu pending budget và lấy lại được result sau expiry.
Không tự chấm 81–93 điểm, không gọi x402 là Avalanche-only, không nói hash chain là trustless.
