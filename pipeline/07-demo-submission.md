# 07 — Demo, video, slides, nộp bài

## 1. Demo script — 6 scene, tối đa 2:30, mỗi scene 1 bằng chứng

Quay từ app thật + Snowtrace thật. Mỗi scene hiển thị tx hash trên
màn hình đủ lâu để đọc (ít nhất 3 giây).

| Scene | Thời lượng | Làm gì trên màn hình | Bằng chứng hiện ra |
|---|---|---|---|
| 1. Discover | 20s | Dashboard: agentId ERC-8004, URI, agentWallet, reputation count + summary (getSummary 4 tham số) | AgentId + link Snowtrace registry |
| 2. Pay tool | 25s | Mission đã kích hoạt → mua `tool:summary` $0.50 qua x402: 402 (operationId) → sign → 200 | Tx hash settlement trên Snowtrace, balance seller tăng, operation SETTLED |
| 3. In-policy payout | 25s | Propose payout 5 USDC trong mission, tới recipient allowlisted → auto execute | Tx hash guard, spentToday + missionSpent tăng |
| 4. Over cap → queue → approve | 35s | Propose 6 USDC → Queued → owner Approve (MetaMask) → Execute (MetaMask) | Tx hash queue + approve + execute, 3 tx rõ ràng |
| 5. Attack blocked + positive control | 25s | Chạy lookalike (chọn 1 đòn rõ nhất, 2 đòn còn lại để ở README test) → BLOCK, rồi chạy ngay một request hợp lệ → thành công | Balance guard không đổi, audit ghi BLOCKED + rule, rồi request hợp lệ thành công (chứng minh không "chặn tất cả") |
| 6. Kill switch | 20s | Owner Pause → propose/reservation mới revert → Unpause → chạy lại | Tx pause/unpause, lỗi revert hiện rõ, sau đó chạy lại thành công. Nói rõ: pause không thu hồi authorization đã ký trong 60s TTL |

**Fallback nếu live fail lúc quay:** dùng tx hash đã ghi sẵn + audit
ledger + video quay trước, không quay lại bằng mock rồi ghi là live.
Video nộp là video đã quay thành công, không phải video "định sẽ
thành công lúc chấm".

**TalkMeter scene (nếu còn thời lượng, hoặc để ở phần mở rộng sau
scene 6, không chen vào giữa):** start → tick 2 phút ($0.10) → stop →
summary + 2 tx hash. Nếu video đã đủ 2:30 thì TalkMeter để ở link
demo riêng, không cắt scene 1–6 để nhét TalkMeter vào.

## 2. Video — yêu cầu nộp bài, kiểm tra trước khi upload

- Độ dài: **2–3 phút** theo yêu cầu (demo script trên là 2:30, đúng
  khoảng này).
- Nội dung: màn hình thật, giọng nói rõ, mỗi claim có tx hash hoặc
  số liệu trên màn hình. Không nhạc át giọng, không text chạy nhanh
  không đọc kịp.
- Upload ở nơi giám khảo mở được không cần login team (YouTube
  unlisted hoặc Drive anyone-with-link — test bằng ẩn danh).
- Tên file/link ghi rõ: `Guarded-Agent-Economy-Demo-2m30s`.

## 3. Slides — outline, mỗi slide 1 ý, mỗi claim 1 bằng chứng

1. Title: tên sản phẩm + 1 câu (00 §1) + team.
2. Problem: agent cầm ví nóng, 3 cách mất tiền (lookalike, approve
   vô hạn, injection) — mỗi cách 1 dòng.
3. Solution: sơ đồ 3 tách quyền (propose / validate+guard / approve)
   + 2 đường tiền tách bạch.
4. Architecture: sơ đồ 00 §4, rút gọn.
5. Guard live: guard address + policy (cap) + link Snowtrace.
6. x402 live: 402 → sign → 200 + tx hash tool purchase.
7. ERC-8004 live: agentId + reputation + tx feedback.
8. Mission budget + receipt: mission, hai budget spent/reserved/
   remaining/expiry, receipt nối mission → policy version → payment
   tx → result hash.
9. Attack đối chứng: naive mất bao nhiêu vs guarded mất bao nhiêu
   tới attacker (bảng số trước/sau, cùng intent/payload) + positive control.
10. Audit ledger: hash chain verify = true (API + script độc lập),
    checkpoint hash, và giới hạn (integrity, không phải trustless).
11. Roadmap / giới hạn trung thực: cái gì chưa làm (validation
    registry, rolling cap, multisig) + cái gì làm tiếp nếu có thời gian.
11. Links: repo, app deploy, video, Snowtrace — tất cả mở được ẩn danh.

**Cấm trong slides:** số liệu không có nguồn, ảnh chụp màn hình
mock ghi như live, địa chỉ mainnet, claim "chống hack tuyệt đối".

## 4. Submission checklist — nộp qua team1vn.xyz, trước 21/11 23:59 VN

### 4a. Checklist chung (cả S1 và S2/S3)

- [ ] Repo public, hoặc private + collaborator `tuantqse90` đã accept.
- [ ] Pitch slides link (Canva/Slides) mở được ẩn danh.
- [ ] Video 2–3 phút link mở được ẩn danh.
- [ ] Bấm **Submit** (draft không tính). Sau khi Submit, chụp màn
      hình xác nhận và lưu lại.
- [ ] Kiểm tra lại bằng trình duyệt ẩn danh: mọi link đều mở được,
      không link nào chỉ team xem được.

### 4b. Nếu chỉ nộp S1 (Rails + TalkMeter) — checklist riêng, không claim thừa

- [ ] README nộp bài có: 1 câu sản phẩm (trục mission), link app,
      facilitator + x402 version thực tế, mission record off-chain,
      cách chạy, bảng tx hash tool + TalkMeter, giới hạn trung thực.
- [ ] Video: scene 1, 2 và 6 (scene 6 reframed thành meeting billing),
      không quay scene guard/queue/feedback chưa xây.
- [ ] Slides: không claim guard contract, human queue on-chain, hay
      ERC-8004 feedback nếu chưa xây. Ghi rõ S1 là gì và S2 sẽ thêm gì.
- [ ] Supporting material: test V/L cho x402 + TalkMeter + operation
      idempotency.

### 4c. Nếu nộp đủ S2/S3 — checklist đầy đủ

- [ ] README nộp bài có: 1 câu sản phẩm, link app, guard address +
      Snowtrace verify, agentId, facilitator + x402 version, mission
      demo, cách chạy, bảng tx hash, checkpoint hash audit, giới hạn
      trung thực (00 §10).
- [ ] Video đủ 6 scene theo §1, slides đủ 11 slide theo §3.
- [ ] Supporting material: pipeline spec này (đã trong repo), test
      report (C/V/L output), attack test số liệu trước/sau +
      positive control.

**Lưu ý Builder Hub:** Builder Hub có deadline/địa điểm khác và tài
khoản riêng (xem context). Coi Team1 là kênh nộp chính cho kế hoạch
này. Nếu organizer xác nhận cần nộp cả Builder Hub thì nộp thêm,
không thay thế Team1 bằng Builder Hub khi chưa có xác nhận.

## 5. Rubric evidence — giám khảo chấm điểm nào thì xem bằng chứng nào

Không dự báo điểm số hay khả năng thắng. Bảng này chỉ liệt kê
bằng chứng tương ứng với từng mục rubric.

| Rubric (điểm) | Bằng chứng nộp kèm | Ở đâu |
|---|---|---|
| Technical 25 | Guard code verified + test C/V/L pass + validator BLOCK/QUEUE | Repo `contracts/`, `pipeline/01`, `pipeline/04`, `pipeline/06` |
| Avalanche 25 | Guard + x402 + ERC-8004 live trên Fuji, tx hash Snowtrace | Video scene 1–3, README bảng tx |
| Creativity 15 | Mission-scoped budget + receipt/proof bundle + replay giải thích | Slides 3, `pipeline/09` (phần core) |
| Impact 15 | Use case mission của nhóm/CLB + tool marketplace 3 tool | Slides 2, app demo |
| Presentation 10 | Video 2:30 đúng script + slides 1 claim = 1 bằng chứng | Video, slides |
| UI/UX 10 | Dashboard policy + mission budget nhìn thấy, queue 1 click, audit verify | App deploy, video |
