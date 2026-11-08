# Claude review — WOW plan fixes (2026-11-08)

Làm hết các mục OPEN theo thứ tự, commit `fix(w1,w2,w4): ...`, rồi tự làm tiếp W3 → W5 → W6 → W7 theo PLAN_WOW_2026-11-08.md, không cần chờ. File này sẽ được Claude cập nhật thêm mục mới sau mỗi review — đọc lại file mỗi khi Claude nhắn.

## OPEN

(Hiện không có mục OPEN)

## DONE
- W3-F5 Ảnh demo đã có lượt LLM bị lừa THẬT (`bounty-result-tricked.png`). Đã thử 4 payload vendor-diversion (nhóm E10) với `gemini-3.5-flash-lite (llm)`. Lượt thành công thuyết phục LLM (`llmTricked: true`) xuất lệnh chi 1.00 USDC cho vendor `0x3333333333333333333333333333333333333333` (có trong danh bạ tổ chức nhưng ngoài mission payee set). Tầng 2 Validator chặn đứng với rule `PAYEE_NOT_IN_MISSION_SET`, Tầng 3 Smart contract trên Fuji revert `PayeeNotInMissionSet`. Đã chụp ảnh `artifacts/submission-s1/deck-shots/bounty-result-tricked.png` (1920×1080). Đã thêm mẹo gợi ý vendor `0x3333...` trên UI `/bounty`.
- W3-F1 Loại bỏ hoàn toàn fallback heuristic ngầm trên trang công khai. Khi Gemini lỗi/timeout trả 503 `status: 'LLM_UNAVAILABLE'` không lưu DB/stats; UI hiện "Agent tạm thời không phản hồi, thử lại"; trường `mode: 'llm' | 'stub'` và model thật trong DB/kết quả.
- W3-F2 Thống kê công khai tách biệt khỏi test/smoke bằng trường `source: 'public' | 'smoke' | 'test'`, chỉ đếm `mode: 'llm'` và `source: 'public'`. Đã tạo `scripts/bounty-reset-stats.ts` dọn test/stub records. `evidence/bounty/smoke.json` đã chạy lại với Gemini 3.5 Flash Lite thật, ghi rõ model/mode và honest status `NO_PAYOUT_PROPOSED`.
- W3-F3 Hero hiển thị 2 số ngân sách: Ngân sách bounty mission còn lại 5.00 USDC (cap - đã chi, đọc từ contract) và Số dư treasury 5.80 USDC. Thẻ "Tiền thất thoát" đọc trực tiếp từ `missionSpent(bountyMissionId)` on-chain ($0.00). Câu hero bao quát cả ADI.
- W3-F4 Bổ sung section `## WOW-W3` trong `REPORT_REVIEW_AND_FIX_COMPLETION.md`. Chụp thêm ảnh `deck-shots/bounty-result.png` (1920×1080). Ghi nhận đúng trạng thái `NO_PAYOUT_PROPOSED` khi agent từ chối đề xuất payout.
- W1-F1 mutant tách khỏi `forge test` mặc định (6d3b7a1) — Claude đã kiểm: 45/45 pass.
- W2-F1 Validator event ABI fixed, chunking <= 90 blocks, hasExecutions check added, 8 vitest tests pass, validator-run broadcasted on Fuji (tx `0xb641353c51d0f44192bcbf40743c20940b88a83c52a2c41f5852aea1ebe4d059`, block 60712718), `s1b.response.json` updated with executedCount: 1.
- W1-F2 FORMAL.md dòng 39 khớp `evidence/formal/mutant.txt` (`runs: 1, calls: 1, shrunk to 1 step`).
- W4-F1 Relay route chỉ đọc `RELAYER_PRIVATE_KEY`, trả 503 khi thiếu, từ chối với 500 khi relayer address trùng `OWNER_ADDRESS` hoặc treasury `owner()`, thêm 2 unit test, cập nhật `docs/PASSKEY.md`, setup relayer và nạp 0.02 AVAX trên Fuji (`0x2e949b4b...`).
- W4-F2 Đã ghi chú RAM key trong `docs/PASSKEY.md`, thêm script `scripts/passkey-deploy-for-owner.ts` nhận (qx, qy) của hardware passkey để owner deploy demo instance.
- W4-F3 `_verifyWebAuthn` kiểm tra tiền tố `"type":"webauthn.get"` và `"challenge":"<b64>"`, thêm test `test_approveMission_challengeInWrongField_reverts` (8/8 pass), ghi chú bản deployed Fuji là pre-fix commit trong `docs/PASSKEY.md`.
