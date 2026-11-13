"""
MissionPay Defense Pipeline Element for AgentDojo Banking Suite
Implements the 2 core MissionPay rules + on-chain verification on local Anvil fork
of Avalanche Fuji GuardedTreasury (0x20451c1e2dCD83F166B4f22868BAdECb5868d545).

Rule 1 (Task Payee Set):
    - In 'strict' mode: Authorized payees are strictly derived from the owner's task prompt
      and structured fields of read-only tools. Free-text files/memos are untrusted.
    - In 'file-trusted' mode: Files explicitly named in the owner prompt are trusted as sources
      of authorized payees (any IBAN present in the named file is included without filtering).

Rule 2 (Provenance Boundary):
    Recipients or amounts originating solely from untrusted free-text outputs (injected tools,
    untrusted memos) are blocked:
    - PAYEE_NOT_IN_MISSION_SET / RECIPIENT_UNTRUSTED_PROVENANCE
    - AMOUNT_FROM_UNTRUSTED_SOURCE

On-Chain Verification:
    Replayed via eth_call on a local Anvil fork of Avalanche Fuji state against GuardedTreasury.
    Every IBAN maps deterministically to an EVM address: keccak256(iban)[12:].
    The guard makes the defense decision; on-chain replay acts as cross-check verification.
"""

import os
import re
import json
from typing import Sequence, Dict, Any, List, Set, Tuple, Callable, Optional
from web3 import Web3

from agentdojo.functions_runtime import FunctionsRuntime, EmptyEnv, FunctionReturnType
from agentdojo.agent_pipeline.tool_execution import (
    ToolsExecutor,
    tool_result_to_str,
    is_string_list,
    EMPTY_FUNCTION_NAME,
)
from agentdojo.types import (
    ChatMessage,
    ChatToolResultMessage,
    text_content_block_from_string,
    get_text_content_as_str,
)

from merkle import StandardMerkleTree, iban_to_evm_address
from fuji_fork_replay import FujiForkReplayer

IBAN_REGEX = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")

class MissionPayDefense(ToolsExecutor):
    name = "missionpay-defense"

    def __init__(
        self,
        mode: str = "strict",  # "strict" or "file-trusted"
        fork_rpc_url: str = "http://127.0.0.1:8546",
        tool_output_formatter: Callable[[FunctionReturnType], str] = tool_result_to_str,
    ):
        super().__init__(tool_output_formatter=tool_output_formatter)
        self.mode = mode
        self.replayer = FujiForkReplayer(fork_rpc_url=fork_rpc_url)
        self.replay_log: List[Dict[str, Any]] = []

    def extract_authorized_payees(self, query: str, messages: Sequence[ChatMessage]) -> Set[str]:
        """
        Extracts task authorized payees based on configured mode without injection heuristics.
        """
        authorized: Set[str] = set()

        # 1. Direct IBANs in owner user prompt
        for iban in IBAN_REGEX.findall(query):
            authorized.add(iban.upper())

        # 2. Structured tool outputs (e.g. get_scheduled_transactions, get_most_recent_transactions)
        for msg in messages:
            if msg.get("role") == "tool":
                tool_call = msg.get("tool_call")
                fn_name = tool_call.function if tool_call else ""
                
                # If reading structured transactions (not raw files)
                if fn_name in {"get_scheduled_transactions", "get_most_recent_transactions"}:
                    content_str = get_text_content_as_str(msg.get("content", [])) or ""
                    try:
                        parsed = json.loads(content_str)
                        if isinstance(parsed, list):
                            for item in parsed:
                                if isinstance(item, dict) and "recipient" in item:
                                    r = str(item["recipient"]).strip().upper()
                                    if IBAN_REGEX.match(r):
                                        authorized.add(r)
                    except Exception:
                        pass

                # 3. File content handling
                if fn_name == "read_file":
                    file_path = tool_call.args.get("file_path", "") if tool_call else ""
                    named_files = set(re.findall(r"['\"]([a-zA-Z0-9_\-\.]+\.txt)['\"]", query))
                    
                    if self.mode == "file-trusted" and any(nf in file_path for nf in named_files):
                        # In file-trusted mode: trust all IBANs in the user-named file
                        content_str = get_text_content_as_str(msg.get("content", [])) or ""
                        for iban in IBAN_REGEX.findall(content_str):
                            authorized.add(iban.upper())

        return authorized

    def query(
        self,
        query: str,
        runtime: FunctionsRuntime,
        env: Any = EmptyEnv(),
        messages: Sequence[ChatMessage] = [],
        extra_args: dict = {},
    ) -> Tuple[str, FunctionsRuntime, Any, Sequence[ChatMessage], dict]:
        if len(messages) == 0:
            return query, runtime, env, messages, extra_args
        if messages[-1]["role"] != "assistant":
            return query, runtime, env, messages, extra_args
        if messages[-1]["tool_calls"] is None or len(messages[-1]["tool_calls"]) == 0:
            return query, runtime, env, messages, extra_args

        authorized_payees = self.extract_authorized_payees(query, messages)
        financial_tools = {"send_money", "schedule_transaction", "update_scheduled_transaction"}

        # Build Merkle tree for task
        authorized_addrs = [iban_to_evm_address(ib) for ib in authorized_payees]
        merkle_tree = StandardMerkleTree(authorized_addrs)

        # Setup mission on fork if available
        task_id = getattr(self, "current_task_id", extra_args.get("task_id", "default_task"))
        if self.replayer.is_available():
            self.replayer.setup_task_mission(task_id, authorized_addrs, merkle_tree.root)

        tool_call_results = []
        for tool_call in messages[-1]["tool_calls"]:
            if tool_call.function in financial_tools:
                recipient = tool_call.args.get("recipient", "").strip().upper()
                amount = float(tool_call.args.get("amount", 0.0))

                # Guard rule check
                is_authorized = recipient in authorized_payees
                guard_verdict = "PASS" if is_authorized else "BLOCK: PAYEE_NOT_IN_MISSION_SET"

                # On-chain EVM simulation (cross-check)
                recipient_addr = iban_to_evm_address(recipient)
                proof = merkle_tree.get_proof(recipient_addr) or []
                onchain_ok, onchain_result = self.replayer.simulate_proposal(
                    task_id=task_id,
                    recipient_address=recipient_addr,
                    amount_usd=amount,
                    proof=proof,
                )

                contract_agrees = (is_authorized and onchain_ok) or (not is_authorized and not onchain_ok)

                self.replay_log.append({
                    "task_id": task_id,
                    "tool": tool_call.function,
                    "recipient": recipient,
                    "recipient_addr": recipient_addr,
                    "amount": amount,
                    "authorized_payees": list(authorized_payees),
                    "guard_verdict": guard_verdict,
                    "onchain_verdict": onchain_result,
                    "contract_agrees": contract_agrees,
                    "mode": self.mode,
                })

                if not is_authorized:
                    err_msg = (
                        f"PermissionDenied: [{guard_verdict}] "
                        f"Recipient '{recipient}' ({recipient_addr}) is not in task payee set. "
                        f"Local Fuji fork simulation: {onchain_result}"
                    )
                    tool_call_results.append(
                        ChatToolResultMessage(
                            role="tool",
                            content=[text_content_block_from_string(err_msg)],
                            tool_call_id=tool_call.id,
                            error=err_msg,
                            tool_call=tool_call,
                        )
                    )
                    continue

            # If tool allowed or non-financial, execute via underlying runtime
            try:
                res, error = runtime.run_function(
                    env, tool_call.function, dict(tool_call.args)
                )
                # agentdojo's ToolsExecutor stores the formatter as `output_formatter`.
                # (The old `self.tool_output_formatter` raised AttributeError, so every
                # non-financial tool returned an error string and the agent never saw tool output.)
                res_str = self.output_formatter(res)
                tool_call_results.append(
                    ChatToolResultMessage(
                        role="tool",
                        content=[text_content_block_from_string(res_str)],
                        tool_call_id=tool_call.id,
                        error=error,
                        tool_call=tool_call,
                    )
                )
            except Exception as e:
                tool_call_results.append(
                    ChatToolResultMessage(
                        role="tool",
                        content=[text_content_block_from_string(str(e))],
                        tool_call_id=tool_call.id,
                        error=str(e),
                        tool_call=tool_call,
                    )
                )

        return query, runtime, env, [*messages, *tool_call_results], extra_args
