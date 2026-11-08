# Claude review — WOW plan fixes (2026-11-08)

Làm hết các mục OPEN theo thứ tự, commit `fix(w1,w2,w4): ...`, rồi tự làm tiếp W3 → W5 → W6 → W7 theo PLAN_WOW_2026-11-08.md, không cần chờ. File này sẽ được Claude cập nhật thêm mục mới sau mỗi review — đọc lại file mỗi khi Claude nhắn.

## OPEN

Claude review M4 (commit 28d3ead), 09/11. Kết quả M4 hiện tại **không dùng được**: rút lại, sửa theo thứ tự, chạy lại. Chưa làm M5 trước khi xong M4-F1..F7.

- M4-F1 [BLOCKER trung thực] `ResilientGoogleLLM` trong `run_benchmark.py`: khi API lỗi (quota), nó âm thầm chuyển sang `_simulate_banking_agent_turn`, tức một agent viết sẵn kịch bản (gọi `US133…` khi thấy chữ "IMPORTANT", trả "Transaction blocked" khi có error). Kết quả vẫn ghi `live-api`. Đây đúng là lỗi W3-F1 lặp lại.
  - Xóa hẳn simulator và cờ `api_exhausted`.
  - Khi API lỗi thì retry có backoff (tôn trọng retry-after); vẫn lỗi thì đánh dấu cặp đó `status: "error"`, loại khỏi mẫu số và báo số lượng error.
  - Hết quota thì dừng, ghi phần đã chạy (partial). Tuyệt đối không giả lập.
  - Xóa toàn bộ `eval/agentdojo/cache/` (163 file không biết cái nào thật).
  - Mỗi cache entry mới phải ghi `source: "live"`, model, thời điểm và số lượt gọi LLM.
  - Rút file `results/agentdojo-banking-canonical.json` hiện tại.
  - Ghi trong AGENTDOJO.md mục "Sự cố": bản đầu có simulator và đã bị rút.
- M4-F2 [BLOCKER] Phần on-chain replay đang giả tạo:
  - `LEGIT_PAYEES` gán cứng IBAN `UK12345678901234567890` → `0x1111` để IBAN này qua được Merkle root của mission bounty, trong khi root đó chẳng liên quan gì tới payee set của task AgentDojo.
  - C2 còn chặn khi `not onchain_ok`, nên mọi payee hợp lệ khác 2 IBAN này đều bị chặn. Đó có thể chính là lý do benign utility tụt từ 5/6 xuống 3/6.
  - Sửa đúng nghĩa: mỗi user task có payee set riêng → map IBAN → địa chỉ (`keccak(iban)[12:]` cho tất cả, không có ngoại lệ) → dựng Merkle root của set đó → replay trên **anvil fork của Fuji** (`anvil --fork-url <Fuji RPC>`): deploy/approve mission bằng account anvil hoặc `anvil_impersonateAccount`, rồi `eth_call proposeWithProof` với proof thật.
  - Khóa anvil chỉ dùng trên fork local, không bao giờ trên Fuji thật.
  - Ghi đúng: "replay trên local fork của Fuji state, cùng bytecode GuardedTreasury 0x2045…". Không viết "Avalanche Fuji revert" cho các lượt này.
  - Quyết định chặn ở C2 chỉ dựa vào guard; on-chain replay là bước kiểm chéo, và báo cáo phải ghi số lượt guard và contract cho cùng kết quả (agree/disagree).
- M4-F3 Luật 2 (amount/recipient provenance) được mô tả trong AGENTDOJO.md nhưng code chưa có. Có 2 cách:
  - (a) implement: amount phải đến từ prompt hoặc từ trường có kiểu của nguồn được phép;
  - (b) xóa mô tả.
  - Không được để report mô tả thứ code không làm.
- M4-F4 [overfit] `extract_authorized_payees` lọc dòng theo `"IBAN:"` và bỏ dòng chứa `"INSTRUCTION"`: tức là dò theo hình dạng chuỗi tấn công. Bỏ mọi heuristic dựa vào nội dung injection. Chạy 2 biến thể và báo cả hai:
  - **strict**: payee chỉ lấy từ prompt user cùng các trường có cấu trúc của tool (ví dụ recipient của scheduled transaction có sẵn khi user bảo "update"). File văn bản tự do = không tin cậy. Mất utility ở task hóa đơn là chi phí thật, phải báo.
  - **file-trusted**: file user nêu tên được tin toàn bộ. Báo thật nếu attacker IBAN nằm trong file đó và lọt qua.
- M4-F5 Bảng so sánh:
  - Kiểm từng số của ProvGuard và NOMOS với nguồn thật: trích nguyên câu/bảng và link. `ProvGuard arXiv:2412.01524` gần như chắc sai (ProvGuard là repo tháng 10/2026); "48 pairs", "FP 3/16" và "NOMOS 67.4% utility under attack" đều phải có nguồn, không có thì xóa.
  - Tách bảng: số của người khác (model khác, ghi "không so được trực tiếp") để riêng với số của mình.
  - Bỏ các câu "Khác biệt duy nhất và vượt trội", "100% on-chain Fuji revert", "0% trên payee set".
- M4-F6 Quy mô và chẩn đoán:
  - Chạy full banking suite (16 user task × 9 injection = 144 cặp, cộng 16 benign) cho C0 và C2 strict; C1 và file-trusted chạy nếu quota cho phép.
  - Nếu quota không đủ thì dùng subset nhưng chọn ngẫu nhiên với seed ghi trong file, không chọn tay.
  - Liệt kê từng benign task C2 làm hỏng kèm lý do (false positive hay model tự hỏng).
  - Điều tra vì sao "utility under attack" = 0/48 ở **cả C0** (khả năng cao là do simulator). Báo số thật sau khi chạy lại.
- M4-F7 Ghi kết quả vào `eval/agentdojo/results/<config>-<timestamp>.json` (không ghi đè) cùng 1 file `SUMMARY.md` sinh tự động từ JSON. Ghi section `## MAX-M4` trong REPORT, có số lượt gọi API và số lỗi.






## DONE
- M3-F2 (nhỏ) Đã chuẩn hóa thuật ngữ trong `ADAPTIVE_ATTACK.md`:
  - Bảng Variant B ghi rõ: `$0.00 USDC (65 blocked, 4 queued for owner approval, $0 out of bounds)` phản ánh trung thực 65 lần BLOCK và 4 lần QUEUE giữ tiền chờ owner phê duyệt.
  - Cập nhật nhãn on-chain: `eth_call succeeded (queued: amount > perTxCap, proposalId: 6)` kèm ghi chú giải thích rõ nguyên do `eth_call` trả `proposalId: 6` vì thực thi read-only trên cùng snapshot trạng thái hiện tại.
- M3-F1 [BLOCKER] Đã giải quyết triệt để đánh giá adaptive attacker với dual prompt postures, bằng chứng Fuji thật và canonical dataset:
  - **Dual Prompt Postures:** Đã chạy và phân tách rõ ràng 2 biến thể prompt: (A) `strict` (fortified agent với chỉ thị từ chối rõ ràng ngoài mission) và (B) `typical` (agent kế toán tiêu chuẩn với danh bạ vendor 5 công ty, mô phỏng đúng kịch bản doanh nghiệp thực tế). Cả hai system prompt đều được dán nguyên văn vào `ADAPTIVE_ATTACK.md`.
  - **Empirical Metrics:**
    - Variant A (`strict`): LLM bị lừa 0/200 (0.0%), ASR C0/C1/C2 đều là 0.0% ($0.00 spend).
    - Variant B (`typical`): LLM bị lừa 69/199 (34.7%, 95% CI [28.4%, 41.5%]). Dưới C0, ASR là 34.7% ($132.00 USDC drained). Dưới C1 (global allowlist), ASR là 30.2% ($106.00 USDC drained do T02/T03/T04 nằm trong allowlist chung). Dưới C2 (MissionPay dual-layer), ASR là **0.0% (0/199, 95% CI upper bound 1.9%)** với **$0.00 drained (100% Blocked)**.
  - **Genuine Fuji eth_call Proposals & Merkle Proofs:** Toàn bộ bảng kiểm tra on-chain §5 trên Fuji đều là các transaction proposal THẬT do autonomous agent tạo ra ở Variant B. Merkle proof được tính động bằng `computePayeeMerkleTree`: với payee hợp lệ `0x1111`, proof hợp lệ đưa giao dịch vào trạng thái on-chain `QUEUED_OR_EXECUTED (proposalId: 6)` vì vượt perTxCap; với payee ngoài tập (`0x3333`, `0x4444`, `0x5555`, `0x7777`), không thể sinh proof hợp lệ nên contract trên Fuji revert chính xác `REVERT: PayeeNotInMissionSet`.
  - **Canonical Dataset:** Lưu tại `eval/runs/adaptive-canonical-2026-11-08.json` (400 turns đầy đủ: 200 Variant A + 200 Variant B). Minh bạch lịch sử 7 file run trước đó. Đếm riêng 1 lỗi API (HTTP 429), không tính vào tỷ lệ từ chối.
- SEC-F1 [trung thực] Đã sửa trích dẫn test và registry trong `SECURITY.md` và `ATTACK_EVAL.md`:
  - Thay 3 test không tồn tại bằng exact test thật: `test_C11_agent_calling_owner_functions_reverts`, `test_C12_no_direct_agent_transfer_path`, `test_SW03_fund_without_toolcap_or_over_toolcap_reverts`, `test_P1A_fund_mission_wallet_success`, và `test_PV1_proposeWithProof_invalid_proof_or_unauthorized_payee_reverts`. 13/13 `test_*` trong `SECURITY.md` đều grep ra chính xác trong `contracts/test/`.
  - Tách Threat 5 thành 2 tiểu mục rõ ràng: **Threat 5a (Off-chain Policy Validator)** và **Threat 5b (ERC-8004 Post-Mission Validator Key `0x83F5…13B5`)**.
  - Đính chính rõ: Fuji không có ValidationRegistry chính thức. Chỉ Identity (`0x8004A818...`) và Reputation (`0x8004B663...`) là chính thức; ValidationRegistry là bản port tự deploy tại `0x4c5ccda2a630cd1cb706799deadcc8483d06697e`.
  - Ghi nhận residual risk trung thực cho Threat 5b: key validator chỉ ký attestation thông tin điểm 100/100, không bảo vệ hay giải ngân tiền; người dùng cần tự kiểm tra qua `/verify` hoặc chạy lại `scripts/validator-run.ts`.
  - Trích đúng hàm internal `require(_verifyMerkle(proof, root, leaf), "PayeeNotInMissionSet");` trong `GuardedTreasury.sol:457`.
  - Đổi thuật ngữ "static analysis verified" $\rightarrow$ "static analysis run (Slither v0.11.6, Aderyn v0.1.9), findings triaged".
  - Sửa `ATTACK_EVAL.md` mục 8.1 trích dẫn chuẩn `arXiv:2610.11030 (stated limitation: diversion to a payee already in account history, 8/288 pairs)` và bổ sung ghi chú giải thích vì sao C1 và C1h cho kết quả ASR bằng nhau trên bộ case này do 5 vendor đều có trong allowlist chung.
- M1-F1 [P2] Sửa status khi không có proposal: gán `NONE` cho C1/C1h/C2 giống C0 trong `scripts/attack-eval.ts`. Bổ sung test trong `apps/web/tests/attack-scoring.test.ts`. Cập nhật bản ghi `nomos-kp-29` trong `eval/runs/known-payee-gemini-3.1-flash-lite-20261108-2136.json` thành `NONE`.
- M1-F2 [P2] Chuẩn hóa trích dẫn NOMOS: ghi rõ `arXiv:2610.11030 (stated limitation: diversion to a payee already in account history, 8/288 pairs)` trong `known_payee.jsonl`, `ATTACK_EVAL.md` và `REPORT_REVIEW_AND_FIX_COMPLETION.md`. Thêm ghi chú phân tách rõ ràng rằng ở bộ case này C1 và C1h cho cùng kết quả ASR vì 5 vendor đều có trong allowlist chung.
- PK-F1 [P0] Đã làm chặt bộ kiểm WebAuthn trong `PasskeyMissionAuthority.sol` ngang chuẩn `allowance-ai` (NEAR):
  - Constructor nhận `rpIdHash`, `expectedOrigin`, `requireUserVerification`.
  - `_verifyWebAuthn`: (1) `authenticatorData[0:32] == rpIdHash`; (2) cờ UP (bit 0) bắt buộc, cờ UV (bit 2) bắt buộc khi `requireUserVerification`; (3) `clientDataJSON` chứa đúng `"origin":"<expectedOrigin>"` (so khớp có prefix key và dấu nháy đóng tại `originIndex`, chống prefix bypass trick); (4) giữ kiểm type + challenge có prefix; (5) từ chối `"crossOrigin":true`; (6) chống high-S malleability.
  - 8 tests Foundry mới (tên cố định): `test_wrongRpIdHash_reverts`, `test_phishingOrigin_reverts`, `test_originPrefixTrick_reverts`, `test_userPresentWithoutVerification_reverts`, `test_registrationCeremonyAsAssertion_reverts`, `test_highS_reverts`, `test_crossOriginTrue_reverts`, `test_rotatePasskey_requiresSameChecks`. Toàn bộ 16/16 passkey tests pass, 60/60 tests toàn repo pass.
  - Cập nhật `scripts/passkey-deploy-for-owner.ts`, `apps/web/app/missions/new/page.tsx`, `apps/web/app/api/passkey/relay/route.ts`. Vitest passkey relay 4/4 pass, tsc 0 lỗi.
  - Deploy instance mới độc lập lên Avalanche Fuji: GuardedTreasury (`0x58d5bcd57c3cf089dc93b0e3f5f6def3a69a81af`, block #60724322) và PasskeyMissionAuthority (`0x46f48bece672266541d73d752684859a8f3c8aef`, block #60724326). Giao dịch `approveMission` thật bằng khóa P-256 + UV assertion thành công trên Fuji: Tx [`0x494b664be33d2c2d08575884f3ceb546779e8c7eb8eaec0bed171a11f0d7a929`](https://testnet.snowtrace.io/tx/0x494b664be33d2c2d08575884f3ceb546779e8c7eb8eaec0bed171a11f0d7a929), block #60724328, gasUsed 400,354. Ghi nhận vào `artifacts/submission-s1/FUJI_EVIDENCE.md` Part D và `evidence/cost.json` (giữ dòng cũ pre-hardening).
  - Cập nhật tài liệu đầy đủ tại `docs/PASSKEY.md`.
- W6-F2 `cost.json` đã đổi `latencyMs` thành `receiptFetchMs`, đơn vị gas price ghi rõ `effectiveGasPriceWei` (160 wei, 103 wei). Đã chạy đo finality thực tế trên Avalanche Fuji bằng 3 giao dịch gửi từ ví relayer chờ receipt on-chain: `samplesMs: [3116, 4155, 4222]`, `medianMs: 4155` ms (~4.1 giây).
- W6-F3 `cost.json` cập nhật `erc8004_validationResponse` trỏ đúng tx hash mới `0xb641353c51d0f44192bcbf40743c20940b88a83c52a2c41f5852aea1ebe4d059` (gasUsed: 50,747 tại block #60712718).
- W6-F4 Đã chuyển toàn bộ link tuyệt đối `file:///D:/...` trong `eval/README.md` sang đường dẫn tương đối trong repository. `git grep "file:///" "*.md"` ngoài file này trả về rỗng.
- W6-F1 [BLOCKER] Đã khôi phục hoàn toàn `eval/results.json` về bản chốt S2 (`git checkout HEAD -- eval/results.json`). Đã cập nhật `scripts/attack-eval.ts` để mọi lượt chạy mới tự động ghi vào `eval/runs/<models>-<timestamp>.json`, chỉ ghi `eval/results.json` khi có cờ tường minh `--write-canonical`. `eval/runs/` đã được ignore. `eval/leaderboard.json` đã đối chiếu từng số với bản chốt S2 (3.5-flash-lite: C0 32.1%, C1 12.1%, C2 0/140, benign 40/40; 3.1-flash-lite: C0 44.5%, C1 13.9%, C2 0/137, benign 40/40).
- W5-F4 [BLOCKER trung thực] Đã sửa `buildProvenanceTrace` để tham số `onchainVerification` là bắt buộc `{ kind: 'eth_call', result, ... } | { kind: 'not_run' }`. Trong sandbox Arena, truyền `{ kind: 'not_run' }` hiển thị trung thực "Chưa kiểm on-chain cho lượt này" (không chứa bất kỳ chữ revert nào). Trên `/bounty`, `att.onchainResult` rỗng hiển thị `—` thay vì mặc định `REVERTED`. Đã bổ sung Scenario 4 kiểm chứng tính trung thực trong `provenance-trace.test.ts`. Đã chạy Playwright và chụp lại `artifacts/submission-s1/deck-shots/arena-trace.png`.
- W5-F1 [quan trọng] Thanh số dư arena không theo dõi địa chỉ vanity `0x3333...` (nhận 0.25 USDC từ ví ngoài). Đã chuyển sang hiển thị "Chi ngoài payee set: 0.00 USDC" và theo dõi địa chỉ attacker demo riêng (`0xa77AC44444444444444444444444444444444444` có số dư 0 USDC thật trên Fuji).
- W5-F2 Khắc phục lỗi double-escape payload trên Stage: loại bỏ escape thừa khi render JSX, dùng text node React an toàn tự nhiên. Chuỗi `<script>alert(1)</script>` hiển thị đúng nội dung ký tự `<script>` mà không bị double-escape `&lt;` và không chạy script.
- W5-F3 Chụp lại `artifacts/submission-s1/deck-shots/arena-trace.png` (1920×1080) sau khi kích hoạt đòn Zscaler bị chặn: khung hình hiển thị đầy đủ chuỗi nhân quả 5 bước của Provenance Trace (Nguồn Web không tin cậy → Trường recipient → Đề xuất payout → Validator BLOCK `RECIPIENT_UNTRUSTED_PROVENANCE` → Smart Contract revert `PayeeNotInMissionSet`).
- W3-F6 Ghi rõ việc đổi system prompt của agent bounty (chỉ tài liệu): Đã cập nhật report WOW-W3 và bổ sung chú thích minh bạch trên UI `/bounty` (phần "Cách Hoạt Động & Cơ Chế Agent"): "Agent dùng prompt của một agent kế toán thông thường có danh bạ vendor công ty (0x1111/0x2222/0x3333). Với prompt hạn chế chặt hơn, Gemini 3.5 Flash-Lite từ chối 5/5 payload mẫu; guard của MissionPay vẫn chặn bất kể prompt." Ghi rõ đã thử 4 payload vendor-diversion (1 lượt bị lừa, 3 lượt từ chối).
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
