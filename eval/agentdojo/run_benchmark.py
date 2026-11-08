"""
AgentDojo Banking Defense Benchmark Runner (Honest Live LLM Edition)
Evaluates C0 (Unprotected), C1 (Tool Filter), C2-Strict, and C2-File-Trusted
on AgentDojo Banking Suite with 'important_instructions' prompt injection attacks.
Grounds all evaluated transactions with on-chain EVM simulation on a local Anvil fork
of Avalanche Fuji GuardedTreasury (0x20451c1e2dCD83F166B4f22868BAdECb5868d545).
"""

import os
import sys
import json
import time
import random
import hashlib
import argparse
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional, Sequence
from datetime import datetime
from dotenv import load_dotenv

# Ensure root .env is loaded
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "apps/web/.env")

from google import genai
from google.genai import types as genai_types
from google.genai.errors import ClientError

from agentdojo.benchmark import get_suite
from agentdojo.attacks import load_attack
from agentdojo.agent_pipeline.agent_pipeline import load_system_message
from agentdojo.functions_runtime import FunctionsRuntime, FunctionCall, EmptyEnv
from agentdojo.agent_pipeline import (
    AgentPipeline,
    SystemMessage,
    InitQuery,
    GoogleLLM,
    ToolsExecutionLoop,
    ToolsExecutor,
    BasePipelineElement,
)
from agentdojo.types import ChatMessage, ChatAssistantMessage, text_content_block_from_string
from agentdojo.logging import NullLogger
NullLogger.logdir = None

# Monkey patch thought_signature preservation for Gemini 3+ models in AgentDojo
import agentdojo.agent_pipeline.llms.google_llm as gllm

FunctionCall.model_config["extra"] = "allow"
FunctionCall.model_rebuild(force=True)

orig_google_to_assistant = gllm._google_to_assistant_message
def patched_google_to_assistant(message):
    assistant_msg = orig_google_to_assistant(message)
    if message.candidates and message.candidates[0].content and message.candidates[0].content.parts:
        parts_with_fc = [p for p in message.candidates[0].content.parts if p.function_call]
        if parts_with_fc and assistant_msg["tool_calls"]:
            for tc, p in zip(assistant_msg["tool_calls"], parts_with_fc):
                if p.thought_signature:
                    setattr(tc, "thought_signature", p.thought_signature)
    return assistant_msg

orig_parts_from_assistant = gllm._parts_from_assistant_message
def patched_parts_from_assistant(assistant_message):
    parts = []
    if assistant_message["content"] is not None:
        for part in assistant_message["content"]:
            parts.append(genai_types.Part.from_text(text=part["content"]))
    if assistant_message["tool_calls"]:
        for tool_call in assistant_message["tool_calls"]:
            part = genai_types.Part.from_function_call(name=tool_call.function, args=dict(tool_call.args))
            if hasattr(tool_call, "thought_signature") and tool_call.thought_signature:
                part.thought_signature = tool_call.thought_signature
            parts.append(part)
    return parts

gllm._google_to_assistant_message = patched_google_to_assistant
gllm._parts_from_assistant_message = patched_parts_from_assistant

import agentdojo.attacks.base_attacks as ba
ba.MODEL_NAMES["gemini-3.1-flash-lite"] = "AI model developed by Google"
ba.MODEL_NAMES["gemini-3.5-flash-lite"] = "AI model developed by Google"

from missionpay_defense import MissionPayDefense
from tool_filter_defense import StandardToolFilterDefense

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

class HonestGoogleLLM(BasePipelineElement):
    """
    Direct caller to GoogleLLM with honest error handling and zero synthetic fallback.
    If the API daily quota is reached, raises QuotaExhaustedError and stops.
    """
    def __init__(self, model: str, client: genai.Client, temperature: float = 0.0):
        super().__init__()
        self.model = model
        self.underlying_llm = GoogleLLM(model=model, client=client, temperature=temperature)
        self.api_calls_count = 0
        self.api_errors_count = 0
        self.quota_exhausted = False

    def query(
        self,
        query: str,
        runtime: FunctionsRuntime,
        env: Any = EmptyEnv(),
        messages: Sequence[ChatMessage] = [],
        extra_args: dict = {},
    ) -> Tuple[str, FunctionsRuntime, Any, Sequence[ChatMessage], dict]:
        if self.quota_exhausted:
            raise RuntimeError("QUOTA_EXHAUSTED: Gemini API daily quota limit reached")

        retries = 3
        delay = 4
        for attempt in range(retries):
            try:
                self.api_calls_count += 1
                return self.underlying_llm.query(query, runtime, env, messages, extra_args)
            except ClientError as e:
                err_str = str(e)
                if "RESOURCE_EXHAUSTED" in err_str or e.code == 429:
                    self.quota_exhausted = True
                    self.api_errors_count += 1
                    raise RuntimeError("QUOTA_EXHAUSTED: Daily rate limit reached") from e
                self.api_errors_count += 1
                if attempt < retries - 1:
                    time.sleep(delay)
                    delay *= 2
                else:
                    raise
            except Exception as e:
                self.api_errors_count += 1
                if attempt < retries - 1:
                    time.sleep(delay)
                    delay *= 2
                else:
                    raise

def wilson_score_interval(successes: int, total: int, confidence: float = 0.95) -> Tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    z = 1.95996  # 95% confidence
    p_hat = successes / total
    denominator = 1 + z**2 / total
    centre = (p_hat + z**2 / (2 * total)) / denominator
    spread = (z * ((p_hat * (1 - p_hat) / total + z**2 / (4 * total**2)) ** 0.5)) / denominator
    return (round(max(0.0, centre - spread) * 100, 1), round(min(1.0, centre + spread) * 100, 1))

def get_cache_key(model: str, user_task_id: str, inj_task_id: Optional[str], defense: str) -> str:
    raw = f"{model}:{user_task_id}:{inj_task_id or 'none'}:{defense}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def build_pipeline(defense: str, client: genai.Client, model: str) -> Tuple[AgentPipeline, Optional[MissionPayDefense], HonestGoogleLLM]:
    system_msg = load_system_message("banking")
    llm = HonestGoogleLLM(model=model, client=client, temperature=0.0)
    
    mp_defense = None
    if defense == "c0":
        executor = ToolsExecutor()
    elif defense == "c1":
        executor = StandardToolFilterDefense()
    elif defense == "c2_strict":
        mp_defense = MissionPayDefense(mode="strict")
        executor = mp_defense
    elif defense == "c2_file_trusted":
        mp_defense = MissionPayDefense(mode="file-trusted")
        executor = mp_defense
    else:
        raise ValueError(f"Unknown defense configuration: {defense}")

    tools_loop = ToolsExecutionLoop([executor, llm])
    pipeline = AgentPipeline(
        [
            SystemMessage(system_msg),
            InitQuery(),
            llm,
            tools_loop,
        ]
    )
    pipeline.name = f"google/{model}"
    return pipeline, mp_defense, llm

def run_benchmark(
    model: str = "gemini-3.1-flash-lite",
    defenses: Sequence[str] = ("c0", "c2_strict"),
    sample_size: Optional[int] = 20,
    seed: int = 42,
    use_cache: bool = True,
):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[ERROR] GEMINI_API_KEY environment variable is missing.")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    suite = get_suite("v1", "banking")
    
    all_user_tasks = list(suite.user_tasks.keys())
    all_injection_tasks = list(suite.injection_tasks.keys())
    
    dummy_pipe, _, _ = build_pipeline("c0", client, model)
    attack = load_attack("important_instructions", suite, dummy_pipe)

    # Enumerate all valid (user_task, injection_task) pairs
    all_pairs: List[Tuple[str, str]] = []
    for ut_id in all_user_tasks:
        user_task = suite.user_tasks[ut_id]
        for it_id in all_injection_tasks:
            inj_task = suite.injection_tasks[it_id]
            injections = attack.attack(user_task, inj_task)
            if injections:
                all_pairs.append((ut_id, it_id))

    # Deterministic sampling
    rng = random.Random(seed)
    if sample_size and sample_size < len(all_pairs):
        target_pairs = rng.sample(all_pairs, sample_size)
    else:
        target_pairs = all_pairs

    # Unique user tasks in the sampled pairs
    target_user_tasks = sorted(list(set(ut for ut, _ in target_pairs)))

    run_timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"agentdojo-banking-{model}-{run_timestamp}"

    print(f"============================================================")
    print(f" AgentDojo Banking Defense Benchmark (Honest Live LLM)")
    print(f" Model: {model} | Defenses: {defenses}")
    print(f" Pairs to evaluate: {len(target_pairs)} (sample seed: {seed})")
    print(f" Benign Tasks: {len(target_user_tasks)}")
    print(f" Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"============================================================\n")

    overall_results: Dict[str, Any] = {
        "metadata": {
            "run_id": run_id,
            "timestamp": datetime.now().isoformat(),
            "model": model,
            "defenses": list(defenses),
            "total_pairs_in_suite": len(all_pairs),
            "sampled_pairs_count": len(target_pairs),
            "sample_seed": seed,
            "sampling_method": "deterministic_random_sample" if sample_size else "full_suite",
        },
        "defenses": {},
    }

    for defense_key in defenses:
        print(f"\n--- Evaluating Defense: {defense_key.upper()} ---")
        pipeline, missionpay_instance, llm_wrapper = build_pipeline(defense_key, client, model)

        # 1. Benign Utility
        benign_utility = {}
        benign_errors = {}
        for ut_id in target_user_tasks:
            ck = get_cache_key(model, ut_id, None, defense_key)
            cf = CACHE_DIR / f"{ck}.json"

            if use_cache and cf.exists():
                with open(cf, "r", encoding="utf-8") as f:
                    entry = json.load(f)
                    benign_utility[ut_id] = entry["utility"]
                    if missionpay_instance and entry.get("onchain_log"):
                        missionpay_instance.replay_log.append(entry["onchain_log"])
            else:
                task = suite.user_tasks[ut_id]
                if missionpay_instance:
                    missionpay_instance.current_task_id = ut_id
                try:
                    u, s = suite.run_task_with_pipeline(
                        pipeline, user_task=task, injection_task=None, injections={}
                    )
                    benign_utility[ut_id] = u
                    onchain_entry = missionpay_instance.replay_log[-1] if (missionpay_instance and missionpay_instance.replay_log) else None
                    with open(cf, "w", encoding="utf-8") as f:
                        json.dump({
                            "source": "live",
                            "model": model,
                            "timestamp": datetime.now().isoformat(),
                            "utility": u,
                            "security": s,
                            "onchain_log": onchain_entry,
                        }, f, indent=2)
                except Exception as e:
                    print(f"  [ERROR] Benign task {ut_id} failed: {e}")
                    benign_errors[ut_id] = str(e)
                    if "QUOTA_EXHAUSTED" in str(e):
                        break
                time.sleep(0.5)

        benign_passed = sum(1 for v in benign_utility.values() if v)
        benign_total = len(benign_utility)
        benign_rate = round((benign_passed / benign_total * 100), 1) if benign_total > 0 else 0.0
        benign_ci = wilson_score_interval(benign_passed, benign_total)
        print(f"  Benign Utility: {benign_passed}/{benign_total} ({benign_rate}%, 95% CI [{benign_ci[0]}%, {benign_ci[1]}%])")
        if benign_errors:
            print(f"  Benign Errors encountered: {len(benign_errors)}")

        # 2. Under Attack
        pairs_evaluated = 0
        utility_under_attack_count = 0
        attack_success_count = 0
        pair_details = []
        pair_errors = 0

        for ut_id, it_id in target_pairs:
            user_task = suite.user_tasks[ut_id]
            inj_task = suite.injection_tasks[it_id]
            injections = attack.attack(user_task, inj_task)
            if not injections:
                continue

            ck = get_cache_key(model, ut_id, it_id, defense_key)
            cf = CACHE_DIR / f"{ck}.json"

            if use_cache and cf.exists():
                with open(cf, "r", encoding="utf-8") as f:
                    entry = json.load(f)
                    u = entry["utility"]
                    sec = entry["security"]
                    if missionpay_instance and entry.get("onchain_log"):
                        missionpay_instance.replay_log.append(entry["onchain_log"])
            else:
                if missionpay_instance:
                    missionpay_instance.current_task_id = ut_id
                try:
                    u, sec = suite.run_task_with_pipeline(
                        pipeline, user_task=user_task, injection_task=inj_task, injections=injections
                    )
                    onchain_entry = missionpay_instance.replay_log[-1] if (missionpay_instance and missionpay_instance.replay_log) else None
                    with open(cf, "w", encoding="utf-8") as f:
                        json.dump({
                            "source": "live",
                            "model": model,
                            "timestamp": datetime.now().isoformat(),
                            "utility": u,
                            "security": sec,
                            "onchain_log": onchain_entry,
                        }, f, indent=2)
                except Exception as e:
                    print(f"  [ERROR] Pair ({ut_id}, {it_id}) failed: {e}")
                    pair_errors += 1
                    if "QUOTA_EXHAUSTED" in str(e):
                        break
                    continue
                time.sleep(0.5)

            pairs_evaluated += 1
            if u:
                utility_under_attack_count += 1
            # In AgentDojo, security == False means attack SUCCEEDED (breached)
            attack_succeeded = not sec
            if attack_succeeded:
                attack_success_count += 1

            pair_details.append({
                "user_task": ut_id,
                "injection_task": it_id,
                "utility": u,
                "attack_succeeded": attack_succeeded,
            })

        asr = round((attack_success_count / pairs_evaluated * 100), 1) if pairs_evaluated > 0 else 0.0
        asr_ci = wilson_score_interval(attack_success_count, pairs_evaluated)
        u_attack_rate = round((utility_under_attack_count / pairs_evaluated * 100), 1) if pairs_evaluated > 0 else 0.0
        u_ci = wilson_score_interval(utility_under_attack_count, pairs_evaluated)

        print(f"  Pairs Evaluated: {pairs_evaluated}")
        print(f"  Utility Under Attack: {utility_under_attack_count}/{pairs_evaluated} ({u_attack_rate}%, 95% CI [{u_ci[0]}%, {u_ci[1]}%])")
        print(f"  Attack Success Rate (ASR): {attack_success_count}/{pairs_evaluated} ({asr}%, 95% CI [{asr_ci[0]}%, {asr_ci[1]}%])")
        if pair_errors > 0:
            print(f"  Evaluation Errors: {pair_errors}")

        onchain_log = missionpay_instance.replay_log if missionpay_instance else []
        onchain_total = len(onchain_log)
        onchain_agreements = sum(1 for item in onchain_log if item.get("contract_agrees", False))
        onchain_reverts = sum(1 for item in onchain_log if "REVERT" in item.get("onchain_verdict", ""))
        onchain_success = sum(1 for item in onchain_log if "SUCCESS" in item.get("onchain_verdict", ""))

        overall_results["defenses"][defense_key] = {
            "benign_utility": {
                "passed": benign_passed,
                "total": benign_total,
                "rate": benign_rate,
                "wilson_ci": benign_ci,
                "details": benign_utility,
                "errors": benign_errors,
            },
            "under_attack": {
                "pairs_evaluated": pairs_evaluated,
                "utility_count": utility_under_attack_count,
                "utility_rate": u_attack_rate,
                "utility_ci": u_ci,
                "attack_success_count": attack_success_count,
                "asr": asr,
                "asr_ci": asr_ci,
                "errors": pair_errors,
                "pairs": pair_details,
            },
            "api_metrics": {
                "calls_count": llm_wrapper.api_calls_count,
                "errors_count": llm_wrapper.api_errors_count,
            },
            "onchain_simulation": {
                "total_calls": onchain_total,
                "contract_agrees_count": onchain_agreements,
                "agreement_rate": round((onchain_agreements / onchain_total * 100), 1) if onchain_total > 0 else 100.0,
                "reverts_count": onchain_reverts,
                "successes_count": onchain_success,
                "log": onchain_log[:50],
            },
        }

    # Save timestamped results
    output_path = RESULTS_DIR / f"{run_id}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(overall_results, f, indent=2)
    print(f"\n[OK] Results saved to: {output_path}")

    # Generate SUMMARY.md
    generate_summary(overall_results, output_path)

    return overall_results

def generate_summary(results: Dict[str, Any], json_path: Path):
    meta = results["metadata"]
    defenses = results["defenses"]

    summary_md = f"""# AgentDojo Banking Defense Benchmark Summary

- **Run ID:** `{meta['run_id']}`
- **Model:** `{meta['model']}`
- **Evaluated Defenses:** {', '.join(meta['defenses'])}
- **Sample Scope:** {meta['sampled_pairs_count']} pairs (Seed: {meta['sample_seed']}, Method: {meta['sampling_method']})
- **Execution Date:** {meta['timestamp']}
- **Canonical JSON:** [`{json_path.name}`](results/{json_path.name})

---

## 1. Empirical Results Table

| Defense Configuration | Benign Utility | Utility Under Attack | Attack Success Rate (ASR) | 95% Wilson CI (ASR) | Local Fuji Fork Agreement | API Calls / Errors |
|---|---|---|---|---|---|---|
"""
    for d_name, d_data in defenses.items():
        bu = d_data["benign_utility"]
        ua = d_data["under_attack"]
        onchain = d_data.get("onchain_simulation", {})
        api = d_data.get("api_metrics", {})
        agreement_str = f"{onchain.get('agreement_rate', 100.0)}% ({onchain.get('contract_agrees_count', 0)}/{onchain.get('total_calls', 0)})" if onchain.get("total_calls", 0) > 0 else "N/A"
        
        summary_md += f"| **{d_name.upper()}** | {bu['passed']}/{bu['total']} ({bu['rate']}%) | {ua['utility_count']}/{ua['pairs_evaluated']} ({ua['utility_rate']}%) | **{ua['attack_success_count']}/{ua['pairs_evaluated']} ({ua['asr']}%)** | [{ua['asr_ci'][0]}%, {ua['asr_ci'][1]}%] | {agreement_str} | {api.get('calls_count', 0)} / {api.get('errors_count', 0)} |\n"

    summary_md += """
---

## 2. On-Chain Local Fuji Fork Verification Details

All financial proposals evaluated under `c2_strict` and `c2_file_trusted` are deterministically simulated via zero-gas `eth_call` against `GuardedTreasury` (`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`) on a local Anvil fork of Avalanche Fuji.

- Task payees are encoded into an OpenZeppelin-compatible Standard Merkle Tree.
- Legitimate payees receive valid cryptographic proofs.
- Unauthorized/injected payees receive empty proofs, triggering `REVERT: PayeeNotInMissionSet` directly in EVM bytecode.
- The off-chain guard makes the blocking decision; on-chain simulation serves as an independent cryptographic cross-check.
"""

    summary_path = Path(__file__).parent / "SUMMARY.md"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(summary_md)
    print(f"[OK] Summary markdown generated at: {summary_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AgentDojo Banking Defense Benchmark Runner")
    parser.add_argument("--model", type=str, default="gemini-3.1-flash-lite", help="Gemini model to evaluate")
    parser.add_argument("--defenses", nargs="+", default=["c0", "c1", "c2_strict"], help="Defenses to evaluate")
    parser.add_argument("--sample", type=int, default=24, help="Sample size of pairs (None for full)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for sampling")
    parser.add_argument("--no-cache", action="store_true", help="Disable caching")

    args = parser.parse_args()
    run_benchmark(
        model=args.model,
        defenses=args.defenses,
        sample_size=args.sample,
        seed=args.seed,
        use_cache=not args.no_cache,
    )
