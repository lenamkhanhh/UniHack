# 01 — Guard contract: GuardedTreasury (Fuji, Solidity)

**Mục tiêu:** hợp đồng duy nhất giữ quỹ. Agent không bao giờ giữ quỹ,
không bao giờ tự chuyển quỹ. Mọi payout đều đi qua hàm này và qua
policy check bằng code.

## 1. Stack và nguyên tắc

- Tooling: **Foundry** (`forge build`, `forge test`, `forge script`).
  Lý do: test nhanh, không cần node server cho contract test.
- Solidity `^0.8.20`, OpenZeppelin v5: `Ownable` (hoặc `Ownable2Step`
  nếu muốn transfer an toàn hơn — chọn 1, ghi rõ), `Pausable`,
  `ReentrancyGuard`, `SafeERC20`.
- **Không upgradeable, không proxy trong MVP.** Lý do pitch: policy
  mà owner đổi ngầm được thì không còn là guard. Mọi đổi policy đều
  qua hàm owner-only và phát event, đọc được trên Snowtrace.
- Token duy nhất trong MVP: **USDC Fuji** (6 decimals). Không nhận
  AVAX, không nhận token lạ — hàm nhận token khác phải revert.
- Pattern: Checks-Effects-Interactions. Cập nhật state (spent, queue)
  **trước** khi gọi `safeTransfer`. Mọi hàm chuyển tiền có
  `nonReentrant`.

## 2. Roles — chỉ 3 vai, không thêm vai cho vui

| Vai | Ai | Quyền |
|---|---|---|
| Owner (human) | Ví người duyệt (MetaMask demo) | Set policy, allowlist, approve/reject queue, pause/unpause, rút tiền khẩn cấp khi paused (xem §7) |
| Agent | Ví agent riêng, chỉ giữ tiền lẻ tool | Chỉ gọi `propose()`. Không gọi được hàm owner, không rút trực tiếp |
| Anyone (read) | Giám khảo, bất kỳ ai | Đọc policy, balance, queue, event — không cần quyền |

**Cấm:** không có hàm nào cho agent tự `execute` trực tiếp mà bỏ qua
policy. `execute()` chỉ chạy cho proposal đã qua check, hoặc proposal
đã được owner approve.

## 3. Storage — viết đúng tên này để frontend/test không lệch

```solidity
address public immutable USDC;          // 0x5425…Bc65 Fuji
address public agent;                   // ví agent duy nhất trong MVP (owner set 1 lần, đổi được)
uint256 public perTxCap;                // mặc định 5_000_000 (5 USDC)
uint256 public dailyCap;                // mặc định 20_000_000 (20 USDC)
uint256 public missionCapDefault;       // mặc định 10_000_000 (10 USDC)

mapping(address => bool) public recipientAllowlist;
mapping(address => bool) public toolAllowlist; // tool contract / seller wallet được payout
mapping(uint256 => uint256) public spentOnDay; // day (UTC) -> tổng đã chi trong ngày đó
mapping(bytes32 => uint256) public missionSpent; // missionId -> đã chi

struct Proposal {
    uint256 id;
    address proposer;      // phải == agent
    address to;            // recipient, phải full-address match allowlist
    uint256 amount;        // USDC atomic units, > 0
    bytes32 missionId;     // 0x0 = không thuộc mission nào
    string reason;         // lý do ngắn, LLM tạo, off-chain hiển thị; on-chain chỉ lưu text ngắn (≤ 200 chars)
    uint8 status;          // 0=Proposed, 1=Queued, 2=Approved, 3=Executed, 4=Rejected, 5=Expired
    uint256 createdAt;
    uint256 expiresAt;     // createdAt + 48 hours cho queued proposal
}
mapping(uint256 => Proposal) public proposals;
uint256 public nextProposalId;
```

**Ngày UTC tính như sau (ghi đúng vào code, đừng tự chế):**

```solidity
function currentDay() public view returns (uint256) {
    return block.timestamp / 1 days; // UTC day number, đủ cho MVP
}
```

## 4. Policy check — thứ tự check, và kết quả của từng trường hợp

Hàm nội bộ `_evaluate(to, amount, missionId)` trả về 1 trong 3:
`EXECUTE` | `QUEUE` | `BLOCK`. Thứ tự quan trọng: **BLOCK trước,
QUEUE sau, EXECUTE cuối**. Đừng đảo thứ tự, vì đảo là lọt tấn công.

| # | Check (theo thứ tự) | Fail thì |
|---|---|---|
| 1 | Contract không paused | BLOCK (`Paused`) |
| 2 | `to` != address(0), `amount` > 0 | BLOCK |
| 3 | `to` nằm trong `recipientAllowlist` — **so full address, không so prefix** | BLOCK (`NotAllowlisted`) |
| 4 | `amount` <= perTxCap | Nếu không → QUEUE (không BLOCK), lý do `OverPerTxCap` |
| 5 | `spentOnDay[currentDay] + amount` <= dailyCap | Nếu không → QUEUE, lý do `OverDailyCap` |
| 6 | Nếu có missionId: `missionSpent[missionId] + amount` <= mission envelope (mặc định missionCapDefault, owner có thể set riêng theo mission) | Nếu không → QUEUE, lý do `OverMissionCap` |
| 7 | Tất cả pass | EXECUTE |

**Lưu ý cho người review (GPT):** đây là lý do daily cap MVP là ngày
UTC chứ không phải rolling 24h — rolling cần lưu lịch sử từng payout
và cộng dồn cửa sổ trượt, code dài hơn, test khó hơn, và demo khó
giải thích trong 25 giây. Nếu muốn rolling, làm ở stretch, không đổi
giữa chừng mà không đổi cả test và pitch (xem 09-breakthroughs).

## 5. Hàm public — interface tối thiểu, đủ dùng

```solidity
// Agent only. Không tự execute ở đây: hàm này tự route theo _evaluate.
function propose(address to, uint256 amount, bytes32 missionId, string calldata reason)
    external returns (uint256 proposalId);

// Owner only. Chỉ chạy proposal đang ở trạng thái Approved (đã qua approve)
// hoặc Queued mà owner vừa approve trong cùng flow — xem flow §6.
// Thực thi: cập nhật spent trước, rồi safeTransfer, rồi emit.
function execute(uint256 proposalId) external onlyOwner whenNotPaused nonReentrant;

// Owner only, cho proposal Queued. Approve không tự chuyển tiền nếu đang paused:
// nếu paused, proposal chuyển sang Approved và chờ unpause rồi mới execute được.
function approve(uint256 proposalId) external onlyOwner;
function reject(uint256 proposalId, string calldata reason) external onlyOwner;

// Owner only, policy + allowlist. Mỗi hàm emit event PolicyUpdated / AllowlistUpdated.
function setCaps(uint256 _perTxCap, uint256 _dailyCap) external onlyOwner;
function setRecipient(address r, bool allowed) external onlyOwner;
function setTool(address t, bool allowed) external onlyOwner;
function setAgent(address a) external onlyOwner;
function setMissionCap(bytes32 missionId, uint256 cap) external onlyOwner;

// Kill switch. pause() chặn propose + execute + tool pre-flight (off-chain cũng check paused).
// unpause() mở lại. Không có hàm nào bypass pause.
function pause() external onlyOwner;
function unpause() external onlyOwner;

// Thoát hiểm: chỉ khi paused, owner mới rút được toàn bộ USDC về ví owner.
// Đây là escape hatch cho demo/hackathon, phải nói rõ trong pitch là chỉ dùng khi paused.
function emergencyWithdraw(address to) external onlyOwner whenPaused nonReentrant;

// Read: frontend dùng hàm này thay vì tự cộng event.
function spentToday() external view returns (uint256);
function proposalCount() external view returns (uint256);
```

## 6. Flow trạng thái — không có đường tắt

```
propose()
  ├─ BLOCK  → revert, không tạo proposal, off-chain ghi audit BLOCKED + reason
  ├─ EXECUTE → tạo proposal status=Executed, spent += amount, transfer ngay
  └─ QUEUE  → tạo proposal status=Queued, expiresAt = now + 48h
                ├─ owner approve() → status=Approved → execute() → Executed
                ├─ owner reject()  → status=Rejected (tiền không đi)
                └─ quá expiresAt  → bất kỳ ai gọi expire() → status=Expired
```

**Expire:** thêm hàm `expire(uint256)` public, ai cũng gọi được, chỉ
chạy khi `status == Queued && block.timestamp > expiresAt`. Không có
expire tự động — blockchain không tự chạy.

## 7. Events — audit ledger off-chain đọc event này, không tự bịa

```solidity
event Proposed(uint256 indexed id, address indexed proposer, address indexed to, uint256 amount, bytes32 missionId);
event Executed(uint256 indexed id, address indexed to, uint256 amount, bytes32 missionId);
event Queued(uint256 indexed id, address indexed to, uint256 amount, string reason); // reason = OverPerTxCap / OverDailyCap / OverMissionCap
event Blocked(address indexed proposer, address indexed to, uint256 amount, string reason); // emit trước revert? Không — revert xóa event.
event Approved(uint256 indexed id);
event Rejected(uint256 indexed id, string reason);
event Expired(uint256 indexed id);
event PolicyUpdated(uint256 perTxCap, uint256 dailyCap);
event AllowlistUpdated(address indexed account, bool allowed, bool isRecipient);
event Paused(address account);
event Unpaused(address account);
```

**Bẫy cần tránh (ghi cho Gemini):** event emit trong transaction bị
revert sẽ bị xóa. Vì vậy trường hợp BLOCK không có event on-chain —
audit ledger off-chain phải ghi BLOCK từ API validator **trước khi**
gọi contract, hoặc từ lỗi revert mà frontend bắt được. Đừng hứa là
"mọi block đều có event".

## 8. Test bắt buộc cho contract (chi tiết full ở 06, đây là list ngắn)

- In-policy execute, đúng amount, đúng recipient, spent tăng đúng.
- Over per-tx cap → queued, không chuyển tiền.
- Over daily cap → queued (dùng ngày UTC, test bằng cách set dailyCap nhỏ).
- Non-allowlisted → revert, balance không đổi.
- Lookalike address (giống đầu/cuối, khác full) → revert.
- Agent gọi hàm owner → revert. Agent rút trực tiếp → không có hàm để rút.
- Pause → propose/execute revert; unpause → chạy lại bình thường.
- Approve → execute chạy; reject → không chạy; expire sau 48h.
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
6. Set policy mặc định (§3), allowlist 2–3 recipient demo, set agent.
7. Điền guard address vào: `05-app.md` env, `spike-checklist` (nếu còn
   trống), README nộp bài, slides.

**Không làm:** không deploy lại contract mới giữa demo mà không cập
nhật mọi nơi ghi address cũ. Một address, dùng xuyên suốt từ S2 tới nộp.
