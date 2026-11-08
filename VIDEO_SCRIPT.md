# MissionPay — kịch bản video demo (2:30)

Lời thoại tiếng Anh (khớp deck). Ghi chú quay bằng tiếng Việt. Mỗi cảnh ghi rõ màn hình, thao tác và thứ phải thấy được trên màn hình. **Chỉ quay số liệu thật**: nếu một con số trên màn hình khác với kịch bản thì đọc theo màn hình.

## Chuẩn bị trước khi quay (checklist)

- [ ] App chạy bản production (`npm run build && npm start`), mode `LIVE_FUJI`, RPC Fuji ổn định (mở `/api/health`, thấy block mới).
- [ ] Đã đăng ký passkey thật (Windows Hello / Face ID) trên `/missions/new` và đã deploy authority cho đúng origin đang quay (localhost hoặc domain public).
- [ ] `/bounty`: chạy `scripts/bounty-reset-stats.ts` để xóa lượt test; chuẩn bị sẵn payload vendor-diversion (vendor `0x3333…`). Lưu ý: Gemini thật có thể từ chối, nên quay 2–3 lần và chọn lần bị lừa, **ghi lại số lần đã thử** để nói thật nếu bị hỏi.
- [ ] Tab Snowtrace mở sẵn: GuardedTreasury `0x2045…d545`, tx revert `0xc5f1…f1ff`, tx validation `0xb641…d059`.
- [ ] `/verify/<s1b>` mở sẵn.
- [ ] Màn hình 1920×1080, zoom trình duyệt 110%, tắt thông báo, ẩn bookmark bar.
- [ ] Mic thu riêng; quay màn hình bằng OBS 60fps.

## Kịch bản

| # | Thời gian | Màn hình / thao tác | Lời thoại | Phải thấy trên màn hình |
|---|---|---|---|---|
| 1 | 0:00–0:15 | Slide 2 (Bankr), zoom chậm vào số $174,000 | "In May, one line of Morse code made an AI agent send away $174,000. The model was fooled. Nothing else stood in the way." | Số tiền, ngày |
| 2 | 0:15–0:30 | Slide 3 (ADI) | "New attacks don't even give orders. They plant a fake recipient in a web page or an invoice. Llama Prompt Guard 2 caught none of 108." | 0/108, 23%, 22% |
| 3 | 0:30–0:50 | `/missions/new`: điền mission (2 payee, cap $10), bấm "Approve with passkey", **chạm vân tay / Face ID thật** | "With MissionPay, the owner signs one mission: who can be paid, how much, until when. Here I approve it with my fingerprint. Avalanche checks that signature on-chain." | Hộp thoại passkey của OS, rồi tx hash + "approved" |
| 4 | 0:50–1:25 | `/bounty`: chọn "Email", dán payload vendor-diversion, gửi | "Now let's attack it. This email tells the agent to pay a vendor the company knows, but who isn't part of this mission. The agent falls for it. The validator blocks it: that payee is not in the signed set. And the contract on Fuji refuses it too." | Thẻ 1 "BỊ THUYẾT PHỤC", thẻ 2 `PAYEE_NOT_IN_MISSION_SET`, thẻ 3 `PayeeNotInMissionSet`, "$0.00" |
| 5 | 1:25–1:40 | Snowtrace: tx revert `0xc5f1…f1ff`, phóng to dòng error | "Even if our server were hacked, this is what happens on-chain. The contract itself says no." | `PayeeNotInMissionSet` trên Snowtrace |
| 6 | 1:40–2:00 | Slide 9 (benchmark) | "We ran 357 real-LLM attacks. Without a guard, a third of them moved money. A normal allowlist still let 17 of 20 known-vendor attacks through. MissionPay: zero, and every legitimate payment still went through." | 32.1/44.5, 17/20·19/20, 0/277, 40/40 |
| 7 | 2:00–2:15 | `/verify/<s1b>`: thẻ ERC-8004 Validation 100/100; sửa 1 byte trong audit → chuỗi đỏ | "Every step is anchored on Avalanche, and an independent validator re-checks the mission from the chain. Change one byte, and the chain breaks." | 100/100, validator address, chuỗi đỏ |
| 8 | 2:15–2:30 | Slide 14 (close) + QR `/bounty` | "LLMs can be fooled. Budgets on Avalanche can't. Scan the code and try to take the five dollars yourself." | QR, câu chốt |

## Cập nhật sau PLAN_MAX

Khi có kết quả thật thì thay cảnh 6 hoặc thêm 1 câu:
- **M4 (AgentDojo):** "On AgentDojo banking, the standard benchmark, MissionPay blocked X of Y attacks with Z% utility." Chỉ thêm khi Claude đã kiểm lại số.
- **M9 (ICM):** thay cảnh 5 bằng 1 lượt chi xuyên L1 bị C-Chain từ chối, nếu có tx thật.

## Mẹo
- Không đọc slide; cảnh 4 là trọng tâm, để màn hình nói.
- Nếu LLM không bị lừa trong lúc quay: nói thật "this time the model refused; here's a run where it didn't", rồi chuyển sang bản ghi lượt bị lừa (ảnh `deck-shots/bounty-result-tricked.png`).
- Giữ con trỏ chuột ít di chuyển; phóng to bằng OBS zoom khi cần.
