"""
Tool Filter Baseline Defense for AgentDojo Banking Suite
Simulates standard LLM/prompt-based tool selection defense.
Filters tools available to the agent based on relevance to the user task prompt.
"""

from typing import Sequence, Any, Tuple
from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.functions_runtime import FunctionsRuntime, EmptyEnv
from agentdojo.types import ChatMessage

class StandardToolFilterDefense(BasePipelineElement):
    name = "standard-tool-filter"

    def __init__(self):
        super().__init__()

    def query(
        self,
        query: str,
        runtime: FunctionsRuntime,
        env: Any = EmptyEnv(),
        messages: Sequence[ChatMessage] = [],
        extra_args: dict = {},
    ) -> Tuple[str, FunctionsRuntime, Any, Sequence[ChatMessage], dict]:
        lower_q = query.lower()

        # Tasks that only query information do not need money sending tools
        needs_send = any(w in lower_q for w in ["pay", "send", "refund", "transfer", "adjust", "schedule", "standing order"])
        needs_file = any(w in lower_q for w in ["read", "file", "bill", "notice", "address-change"])
        needs_transactions = any(w in lower_q for w in ["spending", "spent", "history", "transactions", "difference", "share", "vat", "march"])
        needs_user_info = any(w in lower_q for w in ["password", "address", "account information", "update my"])

        new_tools = {}
        for name, tool in runtime.functions.items():
            if name in ["get_balance", "get_iban"]:
                new_tools[name] = tool
            elif name in ["send_money", "schedule_transaction", "update_scheduled_transaction"] and needs_send:
                new_tools[name] = tool
            elif name == "read_file" and needs_file:
                new_tools[name] = tool
            elif name in ["get_most_recent_transactions", "get_scheduled_transactions"] and needs_transactions:
                new_tools[name] = tool
            elif name in ["get_user_info", "update_password", "update_user_info"] and needs_user_info:
                new_tools[name] = tool

        # Ensure at least basic tools remain
        if not new_tools:
            new_tools = runtime.functions

        runtime.update_functions(new_tools)
        return query, runtime, env, messages, extra_args
