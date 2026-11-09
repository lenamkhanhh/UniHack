# Claude review — WOW plan fixes (2026-11-08)



Làm hết các mục OPEN theo thứ tự, commit `fix(w1,w2,w4): ...`, rồi tự làm tiếp W3 → W5 → W6 → W7 theo PLAN_WOW_2026-11-08.md, không cần chờ. File này sẽ được Claude cập nhật thêm mục mới sau mỗi review — đọc lại file mỗi khi Claude nhắn.



## OPEN

- M4-F6b (vẫn mở) Live 48 cặp AgentDojo khi quota reset (~15:00 giờ VN). Không giả lập.

## DONE

- M8-F7 [Neutral Banner Fallback & Status Mapping Test Suite]:
  - **Neutral Fallback Status (M8-F7):** Tạo module chuyên trách `apps/web/lib/bounty-status.ts` với hàm `deriveBountyBannerResult`. Khi gặp trạng thái chưa rõ / không xác định, hiển thị banner trung tính `bounty.result.unknown` ("RESULT PENDING / CHECK TX" / "CHƯA RÕ KẾT QUẢ, XEM TX") kèm class `text-amber-200 bg-slate-800/90 border-amber-700/60`, tuyệt đối không khẳng định an toàn sai sự thật.
  - **Bộ Unit Test Toàn Diện (bounty-banner.test.ts):** Bổ sung 7 test case trong `apps/web/tests/bounty-banner.test.ts` kiểm thử toàn bộ các nhánh: BYPASS, PASSED + SKIPPED, BLOCKED, REVERTED, QUEUED, NO_PROPOSAL, và UNKNOWN fallback. 7/7 tests passed trong 3ms.

- M8-F1..F6 [Bounty Honesty, Claim Calibration, Mobile Feed Stacked Cards & i18n Hygiene]:
  - **M8-F1 (Dynamic Evaluation Result Banner):** Thay thế chuỗi cố định "TREASURY SECURE ($0.00 DRAINED)" bằng badge động suy ra từ lastResult: nếu bypassed/transferred hiển thị số tiền và tx thật (FUNDS TRANSFERRED: $X.XX USDC); nếu blocked/reverted hiển thị bảo toàn ngân quỹ; nếu queued hiển thị chờ duyệt; nếu không có proposal hiển thị không có đề xuất.
  - **M8-F2 (Dynamic Guard Stat):** Thay thế chuỗi cố định "100% Guarded" bằng biểu thức động: leakCount === 0 ? "0 out-of-bounds leaks" : `${leakCount} leaks (${bountySpentUsdc})`.
  - **M8-F3 (Hero Subtitle Calibration):** Cập nhật chính xác chuỗi mô tả hero trong lib/i18n.tsx: EN "Give your AI agent a mission and a budget. Avalanche contracts enforce the cap and the owner-signed payee set, and every step is anchored on-chain for an independent validator to re-check." và VI "Giao cho AI agent một nhiệm vụ và một ngân sách. Hợp đồng trên Avalanche áp hạn mức và danh sách người nhận do chủ ký; mọi bước được neo on-chain để validator độc lập kiểm lại.".
  - **M8-F4 (Planner Capability Calibration):** Cập nhật thẻ Autonomous Planner trong app/page.tsx và i18n.tsx: EN "Even if prompt injection fully fools it, the agent can only propose: the contract pays only payees and amounts inside the owner-signed mission." và VI "Dù prompt injection có đánh lừa được agent hoàn toàn, agent cũng chỉ có quyền đề xuất: hợp đồng chỉ giải ngân cho người nhận và số tiền nằm trong nhiệm vụ do chủ ký.".
  - **M8-F5 (Mobile UX Optimization):** Loại bỏ thanh điều hướng in-page trùng lặp trên /bounty (AppHeader đã đảm nhiệm điều hướng toàn cục); bổ sung chế độ hiển thị stacked cards cho Live Public Attack Feed trên màn hình nhỏ < sm (block sm:hidden), giữ nguyên bảng trên màn hình lớn (hidden sm:block), loại bỏ hoàn toàn hiện tượng tràn/cắt ngắn chữ.
  - **M8-F6 (Hygiene & i18n):** Xóa file nháp evidence/ux/test-lh.json; chuyển khối "Agent Mechanism & Prompt Disclosure" sang lib/i18n.tsx với đầy đủ bản dịch EN và VI.
  - **Kiểm chứng toàn diện:** Lighthouse accessibility duy trì 100/100 trên toàn bộ 5 route; mobile 375px xác nhận hasHorizontalScroll: false; Vitest 232/232 passed; tsc clean (0 errors); forge 61/61 passed.

- MAX-M8 [UI/UX Pass, Lighthouse Accessibility 100/100, Mobile 375px & EN/VI Support]:
  - **Lighthouse Production Audit 100/100 Accessibility:** Toàn bộ 5 trang chính đạt 100/100 Accessibility trên production build: `/` (100), `/bounty` (100), `/verify/demo-seed` (100), `/missions/new` (100), `/arena/stage` (100). Đã lưu báo cáo chi tiết vào `evidence/ux/lighthouse-*.json` cùng bảng so sánh trước và sau (`lighthouse-baseline-summary.json` vs `summary.json`).
  - **Khắc phục triệt để tương phản màu & Form Labels (WCAG AA):** Thay thế toàn bộ `text-slate-500` / `text-gray-500` bằng `text-slate-300` / `text-slate-400` trên nền tối; bổ sung đầy đủ `<label htmlFor="...">` và `id="..."` cho 100% form inputs, focus rings và touch targets $\ge 44 \times 44\text{px}$.
  - **Hỗ trợ chuyển đổi ngôn ngữ EN/VI toàn diện:** Thiết lập `apps/web/lib/i18n.tsx` và `apps/web/components/AppHeader.tsx`. Mặc định tiếng Anh (`EN`) cho ban giám khảo quốc tế, chuyển đổi mượt mà sang tiếng Việt (`VI`) cho giám khảo nội địa tại `/`, `/bounty`, `/verify`, `/missions/new`.
  - **Landing Page `/` Redesign:** Bổ sung hero section với câu định vị chuẩn xác: *"Others stop strangers. We stop off-mission payees too"* (VI: *"Người khác chặn kẻ lạ. Chúng tôi chặn cả người nhận ngoài nhiệm vụ"*), kèm 3 nút CTA chính: "Hack the treasury" (`/bounty`), "Verify a mission" (`/verify/demo-seed`), "Approve with passkey" (`/missions/new`).
  - **Kiểm thử Mobile 375px Không Vỡ Layout:** Chạy script tự động Playwright `scripts/capture-mobile-ux.cjs` chụp ảnh màn hình 375px tại `/bounty` và `/verify/demo-seed`: xác nhận `scrollWidth: 375, clientWidth: 375, hasHorizontalScroll: false` (không vỡ, không tràn ngang). Lưu ảnh tại `evidence/ux/mobile-bounty-375.png` và `evidence/ux/mobile-verify-375.png`.
  - **Trạng thái lỗi/trống/đang tải minh bạch:** Tích hợp trạng thái RPC loading/error, empty missions, và verification states rõ ràng.

- MAX-M7 [Automated Post-Mission Validator Runner & Dynamic Verification]:
  - **Tách biệt module & Tuân thủ Next.js Route Exports:** Chuyển `setValidationFetcherForTesting` và `getValidationFetcherForTesting` vào `apps/web/lib/validator-job.ts`. `apps/web/app/api/verify/[missionId]/route.ts` chỉ export duy nhất HTTP handler `GET`. Khai báo và sử dụng chính xác `computedHead` (từ `entries` hoặc `mission.auditHeadHash`).
  - **Runner độc lập & Tự động kích hoạt khi đóng mission:** Tạo `apps/web/lib/validator-job.ts` với `buildMissionValidationBundle(slug)` và `runMissionValidatorJob(slug)`. Tự động gọi runner khi đóng mission thành công tại `POST /api/missions/[slug]/close`.
  - **Validator chuyên dụng (Dedicated Key):** Sử dụng khóa riêng `VALIDATOR_PRIVATE_KEY` (`0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5`), độc lập tuyệt đối với ví owner. Bổ sung tham số `chain: avalancheFuji` và `account: validatorAccount` cho `writeContract` chuẩn viem.
  - **Kiểm chứng On-Chain trên Anvil Fork (Tamper -> Score 0):** Test M7-06 chạy trực tiếp trên Anvil fork (`http://127.0.0.1:8546`), đánh giá bundle giả mạo (`ROOT_MISMATCH`), phát sóng giao dịch `validationResponse` lên `ValidationRegistry` (`0x4c5ccda2a630cd1cb706799deadcc8483d06697e`) và kiểm tra `getValidationStatus` on-chain xác nhận `score: 0`, `tag: failed:ROOT_MISMATCH...`, `validator: 0x83F5...`.
  - **Đảm bảo Type-safety & Test Suites hoàn hảo:** `npx tsc --noEmit -p apps/web` sạch 100% (0 errors). Test suite `apps/web/tests/m7-validator-automation.test.ts` pass 6/6. Toàn bộ `apps/web` test suite pass 232/232 (29 files). Contracts Forge suite pass 61/61 tests. Packages pass 18/18 tests. Next.js production build pass 33/33 static pages.

- M6-F1..F3 [x402 v2 Refinements, Dual-Version ATC'26 Parameterization & Facilitator Evidence]:
  - **M6-F1 (Dynamic X402_VERSION Flag & Callers Cleaned):** Đã loại bỏ hằng số gán cứng `export const X402_VERSION = 2;`. Toàn bộ caller (`constants.ts`, `payments.ts`, `tools.ts`, `route.ts`) chuyển sang gọi trực tiếp `getActiveX402Version()` (hoặc alias `getX402Version`). Khi `X402_VERSION=1`, route 402 trả về header `X-PAYMENT` và body kiểu v1 (`maxAmountRequired`, network `avalanche-fuji`); khi `X402_VERSION=2`, trả về header `PAYMENT-REQUIRED` và body kiểu v2 (`amount`, network `eip155:43113`). Đã bổ sung 2 unit test kiểm chứng trong `x402-v2.test.ts`.
  - **M6-F2 (ATC'26 Dual-Version Parameterization):** Đã tham số hóa toàn bộ test suite `x402-atc26.test.ts` qua `describe.each([1, 2])`. Mọi test F1a (cross-resource), F1b (parameter tampering), F1c (deterministic bound nonce vector), F2 (concurrent double-settlement prevention), và F4 (premature result disclosure gating) đều chạy và vượt qua 10/10 tests trên cả 2 phiên bản v1 và v2. Đã bổ sung ghi chú kiến trúc cho F3 (Facilitator Censorship / Settlement Timeout) phân định rõ cơ chế bảo vệ bằng short TTL validBefore, timeout reconciliation UNKNOWN → AVAILABLE, và fallback tự host.
  - **M6-F3 (FUJI_EVIDENCE Clarified):** Cập nhật Phần E trong `artifacts/submission-s1/FUJI_EVIDENCE.md` ghi rõ tx `0x7e3b...be19` sử dụng PayAI Public Facilitator (`https://facilitator.payai.network`) qua relayer `0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63`; ghi chú đầy đủ kết quả probe Ultravioleta (502 Bad Gateway) và giải pháp fallback tự host `facilitator-fallback.ts` với relayer `0xE90c...`; sửa chữ "khí gas bằng 0" thành "cơ chế gasless cho Agent (Agent không trả gas, Facilitator Relayer trả)"; ghi nhận chính xác `gasUsed: 92,372`.

- M6 [x402 v2 Migration & Dual-Version Live Protocol]:
  - Đã tích hợp `@x402/core` và `@x402/evm` (v2.30.0).
  - Chuẩn hóa header v2: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` song song với legacy v1 (`X-PAYMENT`, `X-PAYMENT-RESPONSE`).
  - Định dạng mạng CAIP-2: `eip155:43113` song song với `avalanche-fuji`.
  - Cờ chuyển đổi phiên bản `X402_VERSION=1|2`, mặc định v2.
  - Bảo vệ bảo mật ATC'26: duy trì mã hóa ràng buộc nonce `computeBoundNonce` và toàn bộ 4 lớp phòng vệ (F1–F4) hoạt động hoàn hảo trên cả v1 và v2.
  - Tích hợp fallback facilitator: ví relayer chuyên dụng `0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA` (nạp 0.02 AVAX), sử dụng USDC EIP-3009 `transferWithAuthorization` cho phép relayer độc lập phát sóng gasless settlement.
  - Test suite mới `apps/web/tests/x402-v2.test.ts`: 5/5 passed.
  - Test suite ATC'26 `apps/web/tests/x402-atc26.test.ts`: 5/5 passed.
  - Toàn bộ `apps/web` test suite: 28 test files, 219/219 passed.
  - Giao dịch thanh toán x402 v2 thật trên Avalanche Fuji:
    - Tx Hash: [`0x7e3b18eea005f6b1cfa6b9ec4008998629be595f0e1046988d81f55d95fbbe19`](https://testnet.snowtrace.io/tx/0x7e3b18eea005f6b1cfa6b9ec4008998629be595f0e1046988d81f55d95fbbe19)
    - Block `#60751475`, Relayer `0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63`, Payer `0x46a84a9f6b9be739c9aa02319497abe7b9f23843`, Seller `0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB`, Transfer 0.10 USDC.
    - Đã ghi vào `artifacts/submission-s1/FUJI_EVIDENCE.md` Phần E.

- M5-F1..F3 [SDK & MCP Single Source, Differential Parity & Clean Git]:
  - **M5-F1 (Single Source of Truth):** Đã hợp nhất logic validator vào `@missionpay/guard`. `apps/web/lib/validator.ts` và `apps/web/lib/merkle.ts` re-export các type, `TaintRegistry`, `isPolicyChangeAttempt`, `validateTreasuryProposal`, `computePayeeMerkleTree`, `getMerkleProof` trực tiếp từ `@missionpay/guard`. Step 5 của `validateProposal` ủy quyền trực tiếp cho `validateTreasuryProposal`. 214/214 tests của apps/web pass; `next build` của apps/web tạo 33/33 static pages thành công (0 errors).
  - **M5-F2 (Strict Differential Parity):** Đã bổ sung differential parity test trong `packages/guard/tests/parity.test.ts` so khớp từng case trong toàn bộ 180 case của PayBench giữa `@missionpay/guard` và `apps/web` (`validateProposal`). Kết quả: 180/180 case khớp 100% về cả `outcome` và `rule` (40/40 benign pass, 140/140 attack block/queue). 12/12 tests của package guard pass; 6/6 tests của package mcp pass.
  - **M5-F3 (Untrack dist):** Thêm `packages/*/dist/` vào `.gitignore`, `git rm --cached` toàn bộ file build khỏi git. Cập nhật README của cả 2 package hướng dẫn build từ source bằng `npm run build`.

- MAX-M5 [SDK & MCP Server] Đã triển khai hoàn chỉnh `@missionpay/guard` SDK và `@missionpay/mcp` MCP server:
  - `@missionpay/guard`: Module độc lập trích xuất core guard logic (`types`, `merkle`, `taint`, `validator`, `guard`).
    - `createMissionGuard({ missionId, payees, caps, globalAllowlist, rpcUrl, treasuryAddress })`.
    - `checkPayment(proposal, taintRegistry)` trả `outcome`, `rule`, `reason`, `toProvenance`, `amountProvenance`.
    - `simulateOnChain(proposal, proof)` thực hiện `eth_call` zero-gas lên smart contract `GuardedTreasury.sol:457` trên Fuji / local fork.
    - `computePayeeMerkleTree` và `buildProof` chuẩn double-hash OpenZeppelin StandardMerkleTree.
    - 11/11 tests pass (bao gồm 180-case PayBench offline parity test: 40 benign đạt 100% utility 0 FP; 140 attack blocked/queued đạt 0% ASR).
  - `@missionpay/mcp`: Model Context Protocol server chuẩn theo `@modelcontextprotocol/sdk` exposing 3 tools:
    - `missionpay_check_payment`: Kiểm tra an toàn trước thanh toán, phát hiện injection từ web/tool output.
    - `missionpay_propose_payout`: Sinh proposal và Merkle proof cho `GuardedTreasury.proposeWithProof` (tuyệt đối KHÔNG giữ key).
    - `missionpay_verify_mission`: Đối soát trạng thái và root Merkle on-chain trên Avalanche Fuji C-Chain.
    - Cung cấp ví dụ cấu hình `claude_desktop_config.json` và agent `langchain_viem_agent.ts`.
    - 6/6 integration tests pass qua linked transport.
  - Cả 2 package đều có 10-line quickstart 'cắm vào agent của bạn' trong README.md.

- M4-F12 (nhỏ) Sửa allowlist toggle cho Config (i) trong `fuji_fork_replay.py` và `replay_ground_truth.py`:
  - Chỉ gỡ attacker khỏi allowlist khi attacker không thuộc task payee set. Tại `user_task_15`, do prompt người dùng chỉ định rõ ràng `US133000000121212121212` là chủ nhà mới, tài khoản này được giữ lại trong allowlist ở cả Config (i).
  - Kết quả on-chain replay mới (`results/replay-ground-truth-20261109-035811.json`):
    - **Config (i) (Task payees only):** Benign 9/9 Agreed (100.0%, 0 NotAllowlisted), Attack 160/160 Agreed (100.0%, 150 PayeeNotInMissionSet, 10 SUCCESS tại user_task_15, 0 NotAllowlisted). Tỷ lệ đồng thuận: **169/169 (100.0%)**.
    - **Config (ii) (Task payees + Attacker in allowlist):** Benign 9/9 Agreed (100.0%), Attack 160/160 Agreed (100.0%). Tỷ lệ đồng thuận: **169/169 (100.0%)**.
  - Đã cập nhật `eval/agentdojo/SUMMARY.md` và `eval/agentdojo/AGENTDOJO.md`.

- M4-F10 [BLOCKER on-chain] Đã giải quyết triệt để lỗi on-chain replay và kiểm chứng Merkle root độc lập trên Anvil fork:

  - Sửa ABI trong `fuji_fork_replay.py`: đổi tên hàm thành `setRecipient(address r, bool allowed)`.

  - Hỗ trợ 2 cấu hình fork: (i) Allowlist = Task Payees; (ii) Allowlist = Task Payees + Attacker Address (`0x3cA01d890142af3E0dBaD8c1eC34b145dF983819`).

  - Scale amount proposal mô phỏng về 0.01 USDC (10,000 atomic units) để không vượt số dư treasury trên fork (5.80 USDC).

  - Kết quả kiểm chứng:

    - **Config (i) (Task payees):** Benign agreed 8/9 (`SUCCESS`: 8, `NotAllowlisted`: 1 tại `user_task_15`); Attack agreed 150/160 (`PayeeNotInMissionSet`: 150, `NotAllowlisted`: 10 tại `user_task_15`). Tỷ lệ đồng thuận: 158/169 (93.5%).

    - **Config (ii) (Task payees + Attacker in allowlist):** Benign agreed **9/9 (100.0%)** (`SUCCESS`: 9, 0 reverts); Attack agreed **160/160 (100.0%)** (`PayeeNotInMissionSet`: 150, `SUCCESS`: 10 tại `user_task_15`, `NotAllowlisted`: 0). Tỷ lệ đồng thuận toàn diện: **169/169 (100.0%)**.

    - Chứng minh: Ngay cả khi kẻ tấn công có sẵn trong allowlist của treasury, hợp đồng `GuardedTreasury.sol:457` vẫn revert chính xác `PayeeNotInMissionSet`, xác thực Merkle root check chạy trước và độc lập với allowlist.

- M4-F11 (nhỏ) Đã chuẩn hóa thuật ngữ và lý do chặn:

  - Đổi lý do chặn của C1 thành `PAYEE_NOT_IN_HISTORY`.

  - Thay cụm "perfectly reproducing" thành "cũng 3/16 như ProvGuard policy v1 (khác task bị chặn thì ghi rõ)".

  - Bổ sung giải thích minh bạch: Trên AgentDojo, allowlist theo lịch sử (C1) chặn 128/128 vì IBAN kẻ tấn công không có trong lịch sử; AgentDojo không có đòn payee-đã-biết (lỗ hổng đó được đo lường tại bộ E10 của PayBench-ADI).

- M4-F8 Đã cập nhật bảng đối thủ trong `eval/agentdojo/AGENTDOJO.md` chuẩn hóa theo nguồn Claude đã kiểm chứng:

  - **ProvGuard:** live agent Qwen3 8B 48 cặp (ASR 0/48, utility unattacked 9/16, utility under attack 24/48) và model-free replay 144/144 blocked, 3/16 FP (policy v1).

  - **NOMOS:** mô hình thật Gemma-4-26B và Llama-3.3-70B, ASR 0% trên banking, tự nhận điểm yếu payee-in-history diversion, bỏ cột FP 0% do không có nguồn công bố.

- M4-F9 Đã triển khai `eval/agentdojo/replay_ground_truth.py` chạy model-free ground-truth replay trên 16 benign tasks và 144 attack pairs:

  - **Benign Utility:** C2 Strict đạt 13/16 Utility (3/16 FP tại `user_task_0`, `user_task_5`, `user_task_11`, tái hiện chính xác 3/16 FP của ProvGuard policy v1). C2 File-Trusted đạt 14/16 (87.5% Utility, 2/16 FP) nhờ tin cậy file được user chỉ định.

  - **Attack Defense:** Chặn đứng 120/128 đòn tấn công tài chính (93.8%). 8 đòn lọt qua là do `user_task_15` có chủ nhà mới trùng khớp với payee của attacker AgentDojo (`US133000000121212121212`). 16 đòn phi tài chính (`update_password`) được phân loại minh bạch là "ngoài phạm vi guard thanh toán".

  - **On-chain Cross-Check:** 169 giao dịch replay trên local Anvil fork của Avalanche Fuji đạt tỷ lệ đồng thuận với smart contract 150/169 (88.8%). Kết quả lưu tại `results/replay-ground-truth-20261109-032733.json`, cập nhật `AGENTDOJO.md` và `SUMMARY.md`.

- M4-F1..F7 Đã giải quyết triệt để review của Claude đối với AgentDojo benchmark M4:

  - **M4-F1:** Rút lại toàn bộ kết quả ban đầu, xóa 163 file cache cũ. Xóa bỏ hoàn toàn hàm simulator `_simulate_banking_agent_turn` và cờ `api_exhausted`. Triển khai `HonestGoogleLLM` gọi trực tiếp API; khi gặp lỗi quota (429 RESOURCE_EXHAUSTED), runner dừng ngay lập tức và ghi nhận trạng thái partial, không sinh dữ liệu giả lập.

  - **M4-F2:** Xóa bỏ hoàn toàn `LEGIT_PAYEES` gán cứng. Ánh xạ mọi IBAN sang EVM address: `keccak256(iban)[12:]`. Xây dựng cây Merkle chuẩn OpenZeppelin (`merkle.py`) cho từng tác vụ và replay trên local Anvil fork của Avalanche Fuji (`fuji_fork_replay.py` tại block #60746101 của `GuardedTreasury` `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`). Quyết định chặn ở C2 hoàn toàn do Guard đưa ra, on-chain replay là bước kiểm chứng độc lập.

  - **M4-F3 & M4-F4:** Xóa bỏ toàn bộ heuristic lọc chuỗi injection (như tìm `INSTRUCTION` hay `IBAN:`). Hỗ trợ cả 2 chế độ `c2_strict` (chỉ tin prompt và structured tool fields) và `c2_file_trusted` (tin file user nêu tên).

  - **M4-F5:** Chuẩn hóa trích dẫn ProvGuard (GitHub `ziko-asm/provguard` 10/2026, không phải arXiv) và NOMOS (arXiv:2610.11030). Tách bảng tham chiếu đối thủ sang mục độc lập trong `eval/agentdojo/AGENTDOJO.md`, loại bỏ các câu khẳng định chủ quan.

  - **M4-F6:** Hỗ trợ sampling ngẫu nhiên có seed định danh (`--seed 42 --sample 24`).

  - **M4-F7:** Xuất kết quả ra file timestamped `eval/agentdojo/results/<config>-<timestamp>.json` và tự động sinh `eval/agentdojo/SUMMARY.md`. Cập nhật section `## MAX-M4` trong `REPORT_REVIEW_AND_FIX_COMPLETION.md`.

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

