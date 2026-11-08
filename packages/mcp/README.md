# @missionpay/mcp

> Model Context Protocol (MCP) server for MissionPay smart contract guard & verifiable payout proposals on Avalanche.

Exposes deterministic payment guard verification and Merkle proof generation to LLM agents (Claude Desktop, Cursor, LangChain, AutoGen, CrewAI).

---

### Available MCP Tools

1. **`missionpay_check_payment`**: Validates a proposed payment against deterministic dual-layer Merkle guard, provenance boundaries, and caps without executing on-chain.
2. **`missionpay_propose_payout`**: Generates verifiable payout calldata and cryptographic Merkle proof for `GuardedTreasury.proposeWithProof`. **Note:** This tool NEVER stores, manages, or asks for private keys.
3. **`missionpay_verify_mission`**: Inspects mission status and verifies whether local payee addresses match the on-chain Merkle root on Avalanche Fuji C-Chain.

---

### 10-Line Quickstart: Cắm vào AI Agent của bạn

Thêm cấu hình sau vào `claude_desktop_config.json` hoặc client MCP của agent:

```json
{
  "mcpServers": {
    "missionpay": {
      "command": "npx",
      "args": ["-y", "@missionpay/mcp"],
      "env": {
        "AVALANCHE_FUJI_RPC": "https://api.avax-test.network/ext/bc/C/rpc",
        "GUARDED_TREASURY_ADDRESS": "0x20451c1e2dCD83F166B4f22868BAdECb5868d545"
      }
    }
  }
}
```

Giờ đây, bất cứ khi nào agent đề xuất chuyển tiền, nó bắt buộc phải gọi tool `missionpay_propose_payout` để lấy Merkle proof. Mọi đòn prompt injection cố tình chuyển tiền ra ngoài danh sách nhiệm vụ sẽ bị từ chối với lý do rõ ràng (`RECIPIENT_UNTRUSTED_PROVENANCE` hoặc `PAYEE_NOT_IN_MISSION_SET`).

---

### Running Locally

```bash
# Start MCP server over stdio
npx tsx src/cli.ts
```
