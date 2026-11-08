# Claude review — WOW plan fixes (2026-11-08)

Làm hết các mục OPEN theo thứ tự, commit `fix(w1,w2,w4): ...`, rồi tự làm tiếp W3 → W5 → W6 → W7 theo PLAN_WOW_2026-11-08.md, không cần chờ. File này sẽ được Claude cập nhật thêm mục mới sau mỗi review — đọc lại file mỗi khi Claude nhắn.

## OPEN

(Hiện không có mục OPEN)

## DONE
- W1-F1 mutant tách khỏi `forge test` mặc định (6d3b7a1) — Claude đã kiểm: 45/45 pass.
- W2-F1 Validator event ABI fixed, chunking <= 90 blocks, hasExecutions check added, 8 vitest tests pass, validator-run broadcasted on Fuji (tx `0xb641353c51d0f44192bcbf40743c20940b88a83c52a2c41f5852aea1ebe4d059`, block 60712718), `s1b.response.json` updated with executedCount: 1.
- W1-F2 FORMAL.md dòng 39 khớp `evidence/formal/mutant.txt` (`runs: 1, calls: 1, shrunk to 1 step`).
- W4-F1 Relay route chỉ đọc `RELAYER_PRIVATE_KEY`, trả 503 khi thiếu, từ chối với 500 khi relayer address trùng `OWNER_ADDRESS` hoặc treasury `owner()`, thêm 2 unit test, cập nhật `docs/PASSKEY.md`, setup relayer và nạp 0.02 AVAX trên Fuji (`0x2e949b4b...`).
- W4-F2 Đã ghi chú RAM key trong `docs/PASSKEY.md`, thêm script `scripts/passkey-deploy-for-owner.ts` nhận (qx, qy) của hardware passkey để owner deploy demo instance.
- W4-F3 `_verifyWebAuthn` kiểm tra tiền tố `"type":"webauthn.get"` và `"challenge":"<b64>"`, thêm test `test_approveMission_challengeInWrongField_reverts` (8/8 pass), ghi chú bản deployed Fuji là pre-fix commit trong `docs/PASSKEY.md`.
