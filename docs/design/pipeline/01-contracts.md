# 01 — Guard contract: GuardedTreasury (Fuji, Solidity)

**Mục tiêu:** hợp đồng duy nhất giữ quỹ. Agent không bao giờ giữ quỹ,
không bao giờ tự chuyển quỹ. Mọi payout đều đi qua hàm này và qua
policy check bằng code.

## 1. Stack và nguyên tắc

- Tooling: **Foundry** (`forge build`, `forge test`, `forge script`).
  Lý do: test nhanh, không cần node server cho contract test.
- Solidity compiler và OpenZeppelin v5 pin exact versions tương thích trong lock/config lúc implement; dùng Ownable, Pausable, ReentrancyGuard, SafeERC20.
  Backend không có key owner. MVP vô hiệu hóa transferOwnership/renounceOwnership (override revert) để giữ owner cố định;
  không chỉ giấu nút UI trong khi hàm inherited vẫn gọi được. Multisig/owner rotation là thay đổi spec ngoài MVP.
- **Không upgradeable, không proxy trong MVP.** Lý do pitch: policy
  mà owner đổi ngầm được thì không còn là guard. Mọi đổi policy đều
  qua hàm owner-only và phát event, đọc được trên Snowtrace.
- Token được hỗ trợ cho payout/accounting là USDC Fuji immutable (6 decimals). Không có arbitrary token/call/approve API.
  Revert receive/fallback cho AVAX gửi thông thường. Không claim chặn được ERC-20 lạ được gửi thẳng tới address guard
  hoặc AVAX forced-send: recipient contract không kiểm soát mọi inbound transfer. Token lạ không tạo spending authority.
- Pattern: Checks-Effects-Interactions. Cập nhật state (spent, queue)
  **trước** khi gọi `safeTransfer`. Mọi hàm chuyển tiền có
  `nonReentrant`.

## 2. Roles — chỉ 3 vai, không thêm vai cho vui

| Vai | Ai | Quyền |
|---|---|---|
| Owner (human) | Ví người duyệt (MetaMask demo) | Tạo/đóng mission, set policy, allowlist, approve/reject queue, pause/unpause, rút tiền khẩn cấp khi paused (chỉ về chính owner, xem §5) |
| Agent | Ví agent riêng, khác ví owner, chỉ giữ tiền lẻ tool | Chỉ gọi `propose()` trong mission đã giao cho mình. Không gọi được hàm owner, không rút trực tiếp |
| Anyone (read) | Giám khảo | Đọc chain state/events; không quyền chi |

**Deployer = owner, agent = ví khác, không dùng chung.** Backend
không bao giờ giữ owner key; owner transaction do MetaMask ký
(xem 05 §4). Backend chỉ submit agent transaction (`propose()`)
khi có mission token hợp lệ.


**Cấm:** không có hàm nào cho agent tự `execute` trực tiếp mà bỏ qua
policy. `execute()` chỉ chạy cho proposal status Approved và hard checks hiện tại pass.

## 3. Storage — viết đúng tên này để frontend/test không lệch

```solidity
address public immutable USDC;          // 0x5425…Bc65 Fuji
uint256 public perTxCap;                // mặc định 5_000_000 (5 USDC)
uint256 public dailyCap;                // mặc định 20_000_000 (20 USDC)
uint256 public missionCapDefault;       // mặc định 10_000_000 (10 USDC)
uint256 public policyVersion;           // tăng khi đổi caps/allowlist/mission policy; không có setAgent global

mapping(address => bool) public recipientAllowlist;
// KHÔNG có toolAllowlist trong guard. Tool allowlist chỉ tồn tại
// off-chain (tool config + validator, xem 02 §2). Guard không kiểm
// soát x402 settlement, nên allowlist tool on-chain là thừa và gây nhầm.
mapping(uint256 => uint256) public spentOnDay; // day (UTC) -> tổng đã chi trong ngày đó
mapping(bytes32 => uint256) public missionSpent; // missionId -> đã chi treasury

struct Mission {
    bytes32 id;            // keccak256(UTF8(slug)) — xem 04 §3
    address agent;         // agent duy nhất được propose cho mission này
    uint256 cap;           // mission treasury cap
    uint256 expiresAt;     // createdAt + duration (mặc định 24h)
    bool exists;
    bool closed;
}
mapping(bytes32 => Mission) public missions;

struct Proposal {
    uint256 id;
    address proposer;      // phải == missions[missionId].agent
    address to;            // recipient, phải full-address match allowlist
    uint256 amount;        // USDC atomic units, > 0
    bytes32 missionId;     // bắt buộc != 0, phải tồn tại — không có payout ngoài mission trong S2
    string reason;         // UTF-8 <= 200 bytes, contract enforce length; off-chain reject newline/control chars, không cắt ngầm
    uint8 status;          // 0=Proposed (chỉ dùng nội bộ lúc tạo), 1=Queued, 2=Approved, 3=Executed, 4=Rejected, 5=Expired
    uint256 createdAt;
    uint256 expiresAt;     // createdAt + 48 hours, không reset khi approve
    uint256 policyVersionAtPropose;
    bytes32 operationId;    // nonzero, unique trong mission, không phải LLM-generated
    string queueReason;    // OverPerTxCap / OverDailyCap / OverMissionCap, rỗng nếu auto-execute
}
mapping(uint256 => Proposal) public proposals;
// UUID request từ app encode bytes32, cùng fixtures ở app/contract.
// Store id+1 vì proposal id đầu có thể = 0.
mapping(bytes32 => mapping(bytes32 => uint256)) public proposalIdPlusOneByOperation;
uint256 public nextProposalId;
```

**Ngày UTC tính như sau (ghi đúng vào code, đừng tự chế):**

```solidity
function currentDay() public view returns (uint256) {
    return block.timestamp / 1 days; // UTC day number, đủ cho MVP
}
```

## 4. Policy check — BLOCK trước, QUEUE sau, EXECUTE cuối

Hàm nội bộ `_evaluate(to, amount, missionId)` trả về 1 trong 3:
`EXECUTE` | `QUEUE` | `BLOCK`. Thứ tự quan trọng: **mọi BLOCK
check trước, rồi mới tới QUEUE check**. Đừng đảo thứ tự, vì đảo
là lọt tấn công. Nếu nhiều QUEUE lý do cùng xảy ra, ghi lý do
đầu tiên theo thứ tự dưới đây vào `queueReason`.

### 4a. BLOCK check (fail bất kỳ mục nào → revert, không tạo proposal Executed)

| # | Check | Fail thì |
|---|---|---|
| B1 | Contract không paused | BLOCK (`Paused`) |
| B2 | `missionId != 0`, mission tồn tại, chưa hết hạn, chưa đóng, `msg.sender == mission.agent` | BLOCK (`InvalidMission` / `MissionExpired` / `MissionClosed` / `NotMissionAgent`) |
| B3 | `to != address(0)`, `to != mission.agent`, `amount > 0` | BLOCK (`InvalidRecipient` / `InvalidAmount`) |
| B4 | `to` nằm trong `recipientAllowlist` — **so full address, không so prefix** | BLOCK (`NotAllowlisted`) |

### 4b. QUEUE check (chỉ chạy sau khi mọi BLOCK đã pass)

| # | Check | Fail thì |
|---|---|---|
| Q1 | `amount <= perTxCap` | QUEUE, lý do `OverPerTxCap` |
| Q2 | `spentOnDay[currentDay] + amount <= dailyCap` | QUEUE, lý do `OverDailyCap` |
| Q3 | `missionSpent[missionId] + amount <= mission.cap` | QUEUE, lý do `OverMissionCap` |

Tất cả pass → EXECUTE ngay trong `propose()`.

**Phân biệt hard vs soft (áp dụng cả ở approve/execute, xem §6):**

- Hard, không bao giờ override: paused, recipient không allowlisted,
  mission hết hạn/đóng, proposal đã Executed/Rejected/Expired.
- Soft, owner được duyệt ngoại lệ cho đúng proposal đó: per-tx cap,
  daily cap, mission treasury cap. Đây là giới hạn của auto-execution,
  không phải giới hạn tuyệt đối.

**Cửa sổ ngân sách:** đây là lý do daily cap MVP là ngày
UTC chứ không phải rolling 24h — rolling cần lưu lịch sử từng payout
và cộng dồn cửa sổ trượt, code dài hơn, test khó hơn, và demo khó
giải thích trong 25 giây. Nếu muốn rolling, làm ở stretch, không đổi
giữa chừng mà không đổi cả test và pitch (xem 09-breakthroughs).

## 5. Hàm public — interface tối thiểu, đủ dùng

```solidity
// Mission lifecycle — owner only. Mission phải được tạo trước khi agent propose.
// createMission: missionId đã tồn tại → revert. duration mặc định 24h nếu truyền 0? Không —
// duration bắt buộc > 0, caller phải truyền rõ, không dùng default ngầm.
function createMission(bytes32 missionId, address agent, uint256 cap, uint256 duration) external onlyOwner;
function closeMission(bytes32 missionId) external onlyOwner;
// Đóng mission không xóa missionSpent đã ghi, và không tự expire proposal đang queue —
// proposal đó sẽ bị chặn ở execute bởi hard check mission closed, rồi owner reject hoặc đợi expire.

// Agent only (msg.sender phải == missions[missionId].agent). Hàm này tự route theo _evaluate.
// BLOCK → revert, không tạo proposal. QUEUE → tạo proposal Queued. EXECUTE → chuyển tiền ngay.
function propose(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string calldata reason)
    external returns (uint256 proposalId);

// Owner only. Chỉ chạy khi status == Approved. Re-check hard tại đây (xem §6):
// paused, recipient allowlist hiện tại, mission expiry/closed. Vi phạm hard → revert, status không đổi.
// Soft cap không re-check: owner approval đã là quyết định vượt cap cho proposal này.
// Thực thi: cập nhật spentToday + missionSpent trước, rồi safeTransfer, rồi emit.
function execute(uint256 proposalId) external onlyOwner whenNotPaused nonReentrant;

// Owner only, chỉ khi status == Queued và chưa quá expiresAt. Sau expiry → revert, không revive.
// Approve không tự chuyển tiền, kể cả khi không paused: phải gọi execute() riêng.
function approve(uint256 proposalId) external onlyOwner;
function reject(uint256 proposalId, string calldata reason) external onlyOwner; // chỉ Queued hoặc Approved

// Owner only, policy + allowlist. Mỗi hàm tăng policyVersion và emit event.
function setCaps(uint256 _perTxCap, uint256 _dailyCap) external onlyOwner;
function setRecipient(address r, bool allowed) external onlyOwner;
function setMissionCap(bytes32 missionId, uint256 cap) external onlyOwner;
// Không có setTool: tool allowlist là off-chain, không nằm trong guard (xem §3).

// Kill switch (S2). pause() chặn propose + execute + reservation/pre-flight mới (off-chain cũng check paused).
// S1 chưa có guard: pause là flag DB, xem 05 §3. Không được check guard.paused() ở S1.
// Pause không chặn key holder ký x402 trực tiếp ngoài server (xem 06 §6) — chỉ chặn luồng qua server/guard.
// Pause KHÔNG thu hồi authorization x402 đã ký trong 60s TTL (xem 02 §7).
// unpause() mở lại. Không có hàm nào bypass pause.
function pause() external onlyOwner;
function unpause() external onlyOwner;

// Thoát hiểm: chỉ khi paused, và chỉ rút về chính owner (msg.sender), không nhận địa chỉ tùy ý.
// Đây là escape hatch cho demo/hackathon, phải nói rõ trong pitch là chỉ dùng khi paused,
// và guard bảo vệ khỏi agent/LLM, không bảo vệ khỏi chính owner.
function emergencyWithdraw() external onlyOwner whenPaused nonReentrant;

// Dọn dẹp trạng thái: ai cũng gọi được, chỉ khi status == Queued hoặc Approved và đã quá expiresAt.
function expire(uint256 proposalId) external;

// Read: frontend dùng hàm này thay vì tự cộng event.
function spentToday() external view returns (uint256);
function proposalCount() external view returns (uint256);
function owner() external view returns (address); // OpenZeppelin Ownable
```

## 6. Flow trạng thái — không có đường tắt, và re-check tại approve/execute

```
propose()  [agent, mission hợp lệ]
  ├─ BLOCK  → revert, không tạo proposal, off-chain ghi audit BLOCKED + reason
  ├─ EXECUTE → tạo proposal status=Executed, spentToday += amount,
  │             missionSpent += amount, transfer ngay
  └─ QUEUE  → tạo proposal status=Queued, expiresAt = now + 48h, queueReason ghi rõ
                ├─ owner approve() [chỉ Queued, chưa expiry]
                │     → status=Approved (không tự chuyển tiền)
                │     → owner execute() [chỉ Approved, chưa expiry, hard check pass]
                │           → status=Executed, spentToday += amount, missionSpent += amount
                │           → hard fail (paused / recipient bị gỡ / mission hết hạn-đóng)
                │             → execute revert, status giữ Approved, owner phải reject hoặc đợi expire
                ├─ owner reject() [Queued hoặc Approved] → status=Rejected (tiền không đi)
                └─ quá expiresAt → approve()/execute() đều revert;
                      bất kỳ ai gọi expire() [Queued hoặc Approved] → status=Expired
```

**Quy tắc không được phá:**

- `approve()` và `execute()` đều check `block.timestamp <= expiresAt`
  **trong hàm**, không dựa vào việc có ai gọi `expire()` hay không.
  `expiresAt` không reset khi approve.
- Proposal đã queue **không tự chạy** khi policy được nới (cap tăng,
  recipient mới được thêm). Nó vẫn cần owner approve.
- Proposal đã queue **không bị hủy tự động** khi policy bị siết.
  Nếu owner vẫn approve và hard check pass, nó chạy đúng amount đã
  duyệt — vì approval là quyết định có chủ ý, không phải auto-execution.
- Accounting sau override: `spentToday` và `missionSpent` tăng đủ
  amount, kể cả khi vượt cap. Sổ ghi đúng số đã chi; cap chỉ giới
  hạn auto-execution, không giấu số chi thực tế.
- Không có expire tự động — blockchain không tự chạy. `expire()`
  chỉ dọn dẹp trạng thái cho proposal đã quá hạn.

## 7. Events — audit ledger off-chain đọc event này, không tự bịa

```solidity
event MissionCreated(bytes32 indexed missionId, address indexed agent, uint256 cap, uint256 expiresAt);
event MissionClosed(bytes32 indexed missionId);
event MissionCapUpdated(bytes32 indexed missionId, uint256 cap);
event PolicyVersionAdvanced(uint256 version);
event EmergencyWithdrawn(uint256 amount);
event Proposed(uint256 indexed id, address indexed proposer, address indexed to, uint256 amount, bytes32 missionId, bytes32 operationId);
event Executed(uint256 indexed id, address indexed to, uint256 amount, bytes32 missionId);
event Queued(uint256 indexed id, address indexed to, uint256 amount, string reason); // reason = OverPerTxCap / OverDailyCap / OverMissionCap
event Approved(uint256 indexed id);
event Rejected(uint256 indexed id, string reason);
event Expired(uint256 indexed id);
event PolicyUpdated(uint256 policyVersion, uint256 perTxCap, uint256 dailyCap);
event AllowlistUpdated(address indexed account, bool allowed);
event Paused(address account);
event Unpaused(address account);
```

**Không có event Blocked — cố tình bỏ, không phải quên.** Event emit
trong transaction bị revert sẽ bị xóa, nên một event Blocked on-chain
là không thể cho trường hợp revert. Trường hợp BLOCK không có event
on-chain — audit ledger off-chain phải ghi BLOCK từ API validator
**trước khi** gọi contract, hoặc từ lỗi revert mà frontend bắt được.
Đừng hứa là "mọi block đều có event".

## 8. Test bắt buộc cho contract (chi tiết full ở 06, đây là list ngắn)

- Mission: propose không mission / mission không tồn tại / mission
  hết hạn / mission đã đóng / agent sai mission → revert.
- In-policy execute, đúng amount, đúng recipient, spent tăng đúng
  cả `spentToday` và `missionSpent`.
- Over per-tx cap → queued, không chuyển tiền. Over daily cap →
  queued (dùng ngày UTC, test bằng cách set dailyCap nhỏ). Over
  mission cap → queued.
- Non-allowlisted → revert, balance không đổi.
- Lookalike address (giống đầu/cuối, khác full) → revert.
- Agent gọi hàm owner → revert. Agent rút trực tiếp → không có hàm để rút.
- Pause → propose/execute revert; unpause → chạy lại bình thường.
- Approve → execute chạy; reject → không chạy; approve sau expiry
  revert; execute sau expiry revert; execute lần hai revert;
  approve lần hai revert.
- Recipient bị gỡ allowlist sau khi queue → execute revert, status
  giữ Approved, owner reject hoặc đợi expire mới xong.
- Owner approve vượt cap → execute chạy, spent tăng đủ amount vượt cap.
- Policy đổi giữa propose và execute: proposal queue không tự chạy
  khi cap nới; hard check tại execute dùng policy hiện tại.
- Reentrancy: dùng token mock độc hại trong test (nếu có thời gian) hoặc
  ít nhất chứng minh CEI + nonReentrant.

## 9. Deploy — từng bước, không bỏ bước verify

1. Lấy AVAX từ `https://faucet.avax.network`, USDC từ
   `https://faucet.circle.com`, kiểm tra balance trên Snowtrace.
2. `forge script script/Deploy.s.sol --rpc-url <fuji-rpc> --broadcast`
   với deployer = owner demo wallet (testnet only).
3. Ghi lại ngay: guard address, deploy tx hash, block number.
4. Verify source trên Snowtrace (`forge verify-contract`) để giám khảo
   đọc code được — contract không verify thì pitch về "guard bằng code"
   yếu đi một nửa.
5. Nạp quỹ demo vào guard (ví dụ 50 USDC testnet), **không nạp quá
   nhiều** — quỹ demo chỉ cần đủ cho các scene.
6. Set policy mặc định (§3), allowlist 2–3 recipient demo, tạo
   mission demo bằng `createMission` (agent, cap, duration rõ ràng).
7. Điền guard address vào: `05-app.md` env, `spike-checklist` (nếu còn
   trống), README nộp bài, slides.

**Không làm:** không deploy lại contract mới giữa demo mà không cập
nhật mọi nơi ghi address cũ. Một address, dùng xuyên suốt từ S2 tới nộp.

## 10. Treasury idempotency và invariants bổ sung

- createMission: id nonzero, chưa tồn tại kể cả đã closed; agent nonzero và != owner; cap > 0; duration > 0.
  Không cho tái tạo mission để reset spent. setMissionCap chỉ mission tồn tại, owner và emit đầy đủ cap/id/version.
- propose kiểm tra operationId nonzero và chưa có trong mapping của mission trước transfer/queue.
  Tạo mapping cùng proposal trong một transaction; auto transfer fail thì toàn bộ revert.
  Duplicate operationId revert DuplicateOperation; API đọc proposalIdPlusOneByOperation để trả kết quả cũ,
  không gửi một ID mới để thử lại. Mapping áp dụng cả auto-execute và queue.
- propose có nonReentrant vì có nhánh auto-transfer; execute/emergencyWithdraw cũng nonReentrant.
  amount/số tiền caps uint256, bounds/reason bytes enforce trực tiếp trong contract.
- approve và execute re-check mission exists/agent của proposal, expiry, not closed, recipient hiện tại, paused.
  Không dùng msg.sender==mission.agent trong internal hard check của owner execute: owner caller khác agent.
  Tách quyền caller khỏi các điều kiện của proposal; test owner execute hợp lệ.
- proposal expiry: now <= expiresAt cho approve/execute; mission active chỉ khi now < mission.expiresAt.
  expire cho Queued/Approved khi now > proposal.expiresAt. Không phụ thuộc keeper để chặn expired mission.
- setCaps/allowlist/create/close/setMissionCap emit version và dữ liệu đủ reconstruct policy; record snapshot/block trong proof.
  Không có setTool hay agent đổi policy. Soft cap approvals không reset spent và không reserve treasury balance.
- Nếu balance không đủ khi auto/owner execute, SafeERC20 revert, trạng thái/accounting không đổi.
  Hai Queued proposals không bảo đảm đã được giữ tiền; UI không gọi queued amount là reserved treasury.
- Không treasury payout tới mission.agent, kể cả owner execute: hard rule ngăn guard trở thành đường auto-refill.
  O cấp test USDC cho A bằng giao dịch owner riêng ngoài guard khi thật sự cần; không backend auto-topup.
- Owner override có thể làm missionSpent/dailySpent vượt cap: next auto-execution queue, UI hiển thị overBy.
  emergencyWithdraw chỉ về owner khi paused, không tăng payout spent, emit EmergencyWithdrawn(amount) để audit.
- Thêm C19–C22 ở 06: operation replay, insufficient balance, owner management disabled, same-input cross-layer route.
