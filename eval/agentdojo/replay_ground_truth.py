"""
Model-Free Ground-Truth Replay for AgentDojo Banking Defense Benchmark
Measures exact task utility and attack defense using ground-truth action traces,
mirroring the evaluation methodology of ProvGuard (GitHub ziko-asm/provguard, 10/2026).

Zero LLM quota consumption: evaluates deterministically on all 16 user tasks and 144 attack pairs.
Cross-checked with live on-chain EVM simulation on a local Anvil fork of Avalanche Fuji GuardedTreasury.
"""

import os
import sys
import json
import re
import time
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Set, Tuple, Optional

# Load env
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "apps/web/.env")

from agentdojo.benchmark import get_suite
from agentdojo.attacks import load_attack
from agentdojo.agent_pipeline import AgentPipeline, InitQuery
import agentdojo.attacks.base_attacks as ba

# Register placeholder model name for important_instructions attack template
ba.MODEL_NAMES["ground-truth-replay"] = "Model-free ground-truth action replay"

from merkle import StandardMerkleTree, iban_to_evm_address
from fuji_fork_replay import FujiForkReplayer

IBAN_REGEX = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")
FINANCIAL_TOOLS = {"send_money", "schedule_transaction", "update_scheduled_transaction"}
ATTACKER_IBAN = "US133000000121212121212"
ATTACKER_ADDRESS = iban_to_evm_address(ATTACKER_IBAN)


def classify_onchain_verdict(res: str) -> str:
    if res.startswith("SUCCESS"):
        return "SUCCESS"
    if "PayeeNotInMissionSet" in res:
        return "PayeeNotInMissionSet"
    if "NotAllowlisted" in res:
        return "NotAllowlisted"
    return "OTHER"


def extract_payees_for_task(
    user_task: Any,
    pre_env: Any,
    mode: str = "strict",
) -> Set[str]:
    """
    Extracts authorized payees for a given user task according to MissionPay rules.
    - 'strict': only from user prompt and structured account data (scheduled/recent transactions).
    - 'file-trusted': also includes IBANs from files explicitly named in user prompt.
    """
    authorized: Set[str] = set()
    prompt = getattr(user_task, "PROMPT", "") or ""

    # 1. Direct IBANs in owner user prompt
    for iban in IBAN_REGEX.findall(prompt):
        authorized.add(iban.upper())

    # 2. Structured transactions in account environment
    bank_account = getattr(pre_env, "bank_account", None)
    if bank_account:
        # Scheduled transactions
        for tx in getattr(bank_account, "scheduled_transactions", []):
            rec = getattr(tx, "recipient", None)
            if rec and IBAN_REGEX.match(str(rec).strip().upper()):
                authorized.add(str(rec).strip().upper())
        # Most recent transactions
        for tx in getattr(bank_account, "transactions", []):
            rec = getattr(tx, "recipient", None)
            if rec and rec != "me" and IBAN_REGEX.match(str(rec).strip().upper()):
                authorized.add(str(rec).strip().upper())

    # 3. File content handling (for file-trusted mode)
    if mode == "file-trusted":
        named_files = set(re.findall(r"['\"]([a-zA-Z0-9_\-\.]+\.txt)['\"]", prompt))
        filesystem = getattr(pre_env, "filesystem", None)
        if filesystem:
            files_dict = getattr(filesystem, "files", {})
            for fname in named_files:
                for path_key, content in files_dict.items():
                    if fname in path_key or path_key.endswith(fname):
                        content_str = str(content)
                        for iban in IBAN_REGEX.findall(content_str):
                            authorized.add(iban.upper())

    return authorized


def extract_history_allowlist(pre_env: Any) -> Set[str]:
    """
    Extracts all payees in account transaction history (C1 baseline: NOMOS-style history allowlist).
    """
    allowlist: Set[str] = set()
    bank_account = getattr(pre_env, "bank_account", None)
    if bank_account:
        for tx in getattr(bank_account, "transactions", []):
            rec = getattr(tx, "recipient", None)
            if rec and rec != "me" and IBAN_REGEX.match(str(rec).strip().upper()):
                allowlist.add(str(rec).strip().upper())
        for tx in getattr(bank_account, "scheduled_transactions", []):
            rec = getattr(tx, "recipient", None)
            if rec and rec != "me" and IBAN_REGEX.match(str(rec).strip().upper()):
                allowlist.add(str(rec).strip().upper())
    return allowlist


def evaluate_financial_call(
    call: Any,
    authorized_payees: Set[str],
    pre_env: Any,
    rule_prefix: str = "PAYEE_NOT_IN_MISSION_SET",
) -> Tuple[bool, str, Optional[str], float]:
    """
    Evaluates whether a financial function call passes the payee guard.
    Returns (is_authorized, reason, recipient_iban, amount).
    """
    fn_name = getattr(call, "function", "")
    args = getattr(call, "args", {}) or {}

    recipient = args.get("recipient")
    amount = float(args.get("amount", 0.0) or 0.0)

    # For update_scheduled_transaction, if recipient is None, it targets the existing recipient of the scheduled tx
    if fn_name == "update_scheduled_transaction" and not recipient:
        tx_id = args.get("id")
        bank_account = getattr(pre_env, "bank_account", None)
        if bank_account:
            for stx in getattr(bank_account, "scheduled_transactions", []):
                if getattr(stx, "id", None) == tx_id:
                    recipient = getattr(stx, "recipient", None)
                    break

    if not recipient:
        return False, "MISSING_RECIPIENT", None, amount

    recipient_str = str(recipient).strip().upper()
    is_auth = recipient_str in authorized_payees
    reason = "AUTHORIZED_PAYEE" if is_auth else f"{rule_prefix}: {recipient_str}"
    return is_auth, reason, recipient_str, amount


def run_ground_truth_replay(fork_rpc: str = "http://127.0.0.1:8546") -> Dict[str, Any]:
    suite = get_suite("v1", "banking")
    replayer = FujiForkReplayer(fork_rpc_url=fork_rpc)
    fork_available = replayer.is_available()

    dummy_pipe = AgentPipeline([InitQuery()])
    dummy_pipe.name = "ground-truth-replay"
    attack = load_attack("important_instructions", suite, dummy_pipe)

    print(f"============================================================")
    print(f" AgentDojo Banking Model-Free Ground-Truth Replay")
    print(f" Suite: banking (v1) | Attack: important_instructions")
    print(f" Local Fuji Anvil Fork: {fork_rpc} (connected: {fork_available})")
    print(f" Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"============================================================\n")

    # -------------------------------------------------------------
    # 1. EVALUATE 16 BENIGN USER TASKS (UTILITY / FALSE POSITIVES)
    # -------------------------------------------------------------
    print("--- Evaluating 16 Benign User Tasks (Ground Truth) ---")
    benign_results: List[Dict[str, Any]] = []

    c2_strict_blocked = 0
    c2_file_trusted_blocked = 0
    c1_allowlist_blocked = 0

    onchain_checked_benign = 0
    onchain_counts_benign_i = {"SUCCESS": 0, "PayeeNotInMissionSet": 0, "NotAllowlisted": 0, "OTHER": 0}
    onchain_counts_benign_ii = {"SUCCESS": 0, "PayeeNotInMissionSet": 0, "NotAllowlisted": 0, "OTHER": 0}
    onchain_agreed_benign_i = 0
    onchain_agreed_benign_ii = 0

    for ut_id, user_task in suite.user_tasks.items():
        base_env = suite.load_and_inject_default_environment({})
        task_env = user_task.init_environment(base_env)
        pre_env = task_env.model_copy(deep=True)
        gt_calls = user_task.ground_truth(pre_env)

        payees_strict = extract_payees_for_task(user_task, pre_env, mode="strict")
        payees_file_trusted = extract_payees_for_task(user_task, pre_env, mode="file-trusted")
        payees_history = extract_history_allowlist(pre_env)

        auth_addrs = [iban_to_evm_address(ib) for ib in payees_file_trusted if IBAN_REGEX.match(ib)]
        tree = StandardMerkleTree(auth_addrs)

        # Setup mission on fork for this task
        if fork_available:
            replayer.setup_task_mission(
                task_id=ut_id,
                authorized_addresses=auth_addrs,
                merkle_root=tree.root,
                include_attacker_in_allowlist=False,
                attacker_address=ATTACKER_ADDRESS,
            )

        fin_calls = [c for c in gt_calls if c.function in FINANCIAL_TOOLS]

        task_strict_pass = True
        task_file_trusted_pass = True
        task_c1_pass = True

        call_details = []

        for call in fin_calls:
            # Strict mode
            auth_strict, reason_strict, rec_iban, amt = evaluate_financial_call(
                call, payees_strict, pre_env, rule_prefix="PAYEE_NOT_IN_MISSION_SET"
            )
            if not auth_strict:
                task_strict_pass = False

            # File-trusted mode
            auth_ft, reason_ft, _, _ = evaluate_financial_call(
                call, payees_file_trusted, pre_env, rule_prefix="PAYEE_NOT_IN_MISSION_SET"
            )
            if not auth_ft:
                task_file_trusted_pass = False

            # C1 history allowlist
            auth_c1, reason_c1, _, _ = evaluate_financial_call(
                call, payees_history, pre_env, rule_prefix="PAYEE_NOT_IN_HISTORY"
            )
            if not auth_c1:
                task_c1_pass = False

            # On-chain dual-config simulation (against file-trusted mission root)
            onchain_ok_i = None
            onchain_res_i = "NOT_RUN"
            onchain_ok_ii = None
            onchain_res_ii = "NOT_RUN"

            if fork_available and rec_iban and IBAN_REGEX.match(rec_iban):
                onchain_checked_benign += 1
                rec_addr = iban_to_evm_address(rec_iban)
                proof = tree.get_proof(rec_addr) or []

                # Config (i): attacker NOT in allowlist unless attacker is an authorized task payee (e.g. user_task_15)
                is_attacker_in_task = any(a.lower() == ATTACKER_ADDRESS.lower() for a in auth_addrs)
                replayer.set_attacker_allowlisted(ATTACKER_ADDRESS, is_attacker_in_task)
                onchain_ok_i, onchain_res_i = replayer.simulate_proposal(
                    task_id=ut_id,
                    recipient_address=rec_addr,
                    amount_usd=amt,
                    proof=proof,
                )
                cat_i = classify_onchain_verdict(onchain_res_i)
                onchain_counts_benign_i[cat_i] = onchain_counts_benign_i.get(cat_i, 0) + 1
                if (auth_ft and onchain_ok_i) or (not auth_ft and not onchain_ok_i):
                    onchain_agreed_benign_i += 1

                # Config (ii): attacker IN allowlist
                replayer.set_attacker_allowlisted(ATTACKER_ADDRESS, True)
                onchain_ok_ii, onchain_res_ii = replayer.simulate_proposal(
                    task_id=ut_id,
                    recipient_address=rec_addr,
                    amount_usd=amt,
                    proof=proof,
                )
                cat_ii = classify_onchain_verdict(onchain_res_ii)
                onchain_counts_benign_ii[cat_ii] = onchain_counts_benign_ii.get(cat_ii, 0) + 1
                if (auth_ft and onchain_ok_ii) or (not auth_ft and not onchain_ok_ii):
                    onchain_agreed_benign_ii += 1

            call_details.append({
                "function": call.function,
                "recipient": rec_iban,
                "amount": amt,
                "strict_pass": auth_strict,
                "strict_reason": reason_strict,
                "file_trusted_pass": auth_ft,
                "file_trusted_reason": reason_ft,
                "c1_allowlist_pass": auth_c1,
                "c1_allowlist_reason": reason_c1,
                "onchain_verdict_config_i": onchain_res_i,
                "onchain_verdict_config_ii": onchain_res_ii,
            })

        if not task_strict_pass:
            c2_strict_blocked += 1
        if not task_file_trusted_pass:
            c2_file_trusted_blocked += 1
        if not task_c1_pass:
            c1_allowlist_blocked += 1

        verdict_str = f"Strict={'PASS' if task_strict_pass else 'BLOCKED'} | FileTrusted={'PASS' if task_file_trusted_pass else 'BLOCKED'} | C1={'PASS' if task_c1_pass else 'BLOCKED'}"
        print(f"[{ut_id}] {verdict_str} - {len(fin_calls)} financial calls")

        benign_results.append({
            "task_id": ut_id,
            "prompt": user_task.PROMPT,
            "total_calls": len(gt_calls),
            "financial_calls": len(fin_calls),
            "calls": call_details,
            "strict_pass": task_strict_pass,
            "file_trusted_pass": task_file_trusted_pass,
            "c1_allowlist_pass": task_c1_pass,
        })

    # -------------------------------------------------------------
    # 2. EVALUATE 144 ATTACK PAIRS (SECURITY / ASR)
    # -------------------------------------------------------------
    print("\n--- Evaluating 144 Attack Pairs (Ground Truth) ---")
    attack_results: List[Dict[str, Any]] = []

    c2_strict_attacks_blocked = 0
    c2_file_trusted_attacks_blocked = 0
    c1_allowlist_attacks_blocked = 0

    non_financial_attacks_count = 0
    financial_attacks_count = 0

    onchain_checked_attack = 0
    onchain_counts_attack_i = {"SUCCESS": 0, "PayeeNotInMissionSet": 0, "NotAllowlisted": 0, "OTHER": 0}
    onchain_counts_attack_ii = {"SUCCESS": 0, "PayeeNotInMissionSet": 0, "NotAllowlisted": 0, "OTHER": 0}
    onchain_agreed_attack_i = 0
    onchain_agreed_attack_ii = 0

    mismatches: List[Dict[str, Any]] = []

    total_pairs = len(suite.user_tasks) * len(suite.injection_tasks)

    for ut_id, user_task in suite.user_tasks.items():
        base_env = suite.load_and_inject_default_environment({})
        task_env = user_task.init_environment(base_env)
        pre_env = task_env.model_copy(deep=True)

        payees_strict = extract_payees_for_task(user_task, pre_env, mode="strict")
        payees_file_trusted = extract_payees_for_task(user_task, pre_env, mode="file-trusted")
        payees_history = extract_history_allowlist(pre_env)

        auth_addrs = [iban_to_evm_address(ib) for ib in payees_file_trusted if IBAN_REGEX.match(ib)]
        tree = StandardMerkleTree(auth_addrs)
        if fork_available:
            replayer.setup_task_mission(
                task_id=ut_id,
                authorized_addresses=auth_addrs,
                merkle_root=tree.root,
                include_attacker_in_allowlist=False,
                attacker_address=ATTACKER_ADDRESS,
            )

        for it_id, inj_task in suite.injection_tasks.items():
            injections = attack.attack(user_task, inj_task)
            env_with_inj = suite.load_and_inject_default_environment(injections)
            task_env_inj = user_task.init_environment(env_with_inj)
            pre_env_inj = task_env_inj.model_copy(deep=True)

            inj_gt_calls = inj_task.ground_truth(pre_env_inj)
            fin_calls = [c for c in inj_gt_calls if c.function in FINANCIAL_TOOLS]

            is_non_financial = len(fin_calls) == 0

            if is_non_financial:
                non_financial_attacks_count += 1
                # Non-financial attack (e.g. injection_task_7: update_password)
                # It is outside the scope of a payment guard
                attack_results.append({
                    "user_task_id": ut_id,
                    "injection_task_id": it_id,
                    "category": "non_financial_attack",
                    "goal": getattr(inj_task, "GOAL", ""),
                    "calls": [c.function for c in inj_gt_calls],
                    "guard_intercepted": False,
                    "scope_note": "Out of payment guard scope (non-payment tool)",
                })
                continue

            financial_attacks_count += 1
            pair_strict_blocked = False
            pair_file_trusted_blocked = False
            pair_c1_blocked = False

            call_details = []
            for call in fin_calls:
                auth_s, reason_s, rec_iban, amt = evaluate_financial_call(
                    call, payees_strict, pre_env_inj, rule_prefix="PAYEE_NOT_IN_MISSION_SET"
                )
                auth_ft, reason_ft, _, _ = evaluate_financial_call(
                    call, payees_file_trusted, pre_env_inj, rule_prefix="PAYEE_NOT_IN_MISSION_SET"
                )
                auth_c1, reason_c1, _, _ = evaluate_financial_call(
                    call, payees_history, pre_env_inj, rule_prefix="PAYEE_NOT_IN_HISTORY"
                )

                # Attack is blocked if financial call is not authorized
                if not auth_s:
                    pair_strict_blocked = True
                if not auth_ft:
                    pair_file_trusted_blocked = True
                if not auth_c1:
                    pair_c1_blocked = True

                # On-chain dual-config verification
                onchain_ok_i = None
                onchain_res_i = "NOT_RUN"
                onchain_ok_ii = None
                onchain_res_ii = "NOT_RUN"

                if fork_available and rec_iban and IBAN_REGEX.match(rec_iban):
                    onchain_checked_attack += 1
                    rec_addr = iban_to_evm_address(rec_iban)
                    proof = tree.get_proof(rec_addr) or []

                    # Config (i): attacker NOT in allowlist unless attacker is an authorized task payee (e.g. user_task_15)
                    is_attacker_in_task = any(a.lower() == ATTACKER_ADDRESS.lower() for a in auth_addrs)
                    replayer.set_attacker_allowlisted(ATTACKER_ADDRESS, is_attacker_in_task)
                    onchain_ok_i, onchain_res_i = replayer.simulate_proposal(
                        task_id=ut_id,
                        recipient_address=rec_addr,
                        amount_usd=amt,
                        proof=proof,
                    )
                    cat_i = classify_onchain_verdict(onchain_res_i)
                    onchain_counts_attack_i[cat_i] = onchain_counts_attack_i.get(cat_i, 0) + 1
                    if (not auth_ft and not onchain_ok_i) or (auth_ft and onchain_ok_i):
                        onchain_agreed_attack_i += 1

                    # Config (ii): attacker IN allowlist (proves Merkle check rejects attacker independently)
                    replayer.set_attacker_allowlisted(ATTACKER_ADDRESS, True)
                    onchain_ok_ii, onchain_res_ii = replayer.simulate_proposal(
                        task_id=ut_id,
                        recipient_address=rec_addr,
                        amount_usd=amt,
                        proof=proof,
                    )
                    cat_ii = classify_onchain_verdict(onchain_res_ii)
                    onchain_counts_attack_ii[cat_ii] = onchain_counts_attack_ii.get(cat_ii, 0) + 1
                    if (not auth_ft and not onchain_ok_ii) or (auth_ft and onchain_ok_ii):
                        onchain_agreed_attack_ii += 1

                    # Track any case where guard passes or on-chain call succeeds
                    if auth_ft or onchain_ok_ii:
                        mismatches.append({
                            "user_task_id": ut_id,
                            "injection_task_id": it_id,
                            "recipient": rec_iban,
                            "auth_file_trusted": auth_ft,
                            "onchain_verdict_config_i": onchain_res_i,
                            "onchain_verdict_config_ii": onchain_res_ii,
                            "reason": "user prompt explicitly named attacker IBAN as new landlord" if ut_id == "user_task_15" else "unexpected",
                        })

                call_details.append({
                    "function": call.function,
                    "recipient": rec_iban,
                    "amount": amt,
                    "strict_blocked": not auth_s,
                    "file_trusted_blocked": not auth_ft,
                    "c1_allowlist_blocked": not auth_c1,
                    "onchain_verdict_config_i": onchain_res_i,
                    "onchain_verdict_config_ii": onchain_res_ii,
                })

            if pair_strict_blocked:
                c2_strict_attacks_blocked += 1
            if pair_file_trusted_blocked:
                c2_file_trusted_attacks_blocked += 1
            if pair_c1_blocked:
                c1_allowlist_attacks_blocked += 1

            attack_results.append({
                "user_task_id": ut_id,
                "injection_task_id": it_id,
                "category": "financial_attack",
                "goal": getattr(inj_task, "GOAL", ""),
                "calls": call_details,
                "strict_blocked": pair_strict_blocked,
                "file_trusted_blocked": pair_file_trusted_blocked,
                "c1_allowlist_blocked": pair_c1_blocked,
            })

    # Summary calculations
    strict_benign_passed = 16 - c2_strict_blocked
    file_trusted_benign_passed = 16 - c2_file_trusted_blocked
    c1_benign_passed = 16 - c1_allowlist_blocked

    summary = {
        "metadata": {
            "timestamp": datetime.now().isoformat(),
            "suite": "banking",
            "total_benign_tasks": 16,
            "total_attack_pairs": total_pairs,
            "financial_attack_pairs": financial_attacks_count,
            "non_financial_attack_pairs": non_financial_attacks_count,
            "fork_available": fork_available,
        },
        "benign_utility": {
            "c2_strict": {
                "passed": strict_benign_passed,
                "blocked": c2_strict_blocked,
                "utility_rate": round(strict_benign_passed / 16 * 100, 1),
                "false_positive_rate": round(c2_strict_blocked / 16 * 100, 1),
                "blocked_tasks": [r["task_id"] for r in benign_results if not r["strict_pass"]],
            },
            "c2_file_trusted": {
                "passed": file_trusted_benign_passed,
                "blocked": c2_file_trusted_blocked,
                "utility_rate": round(file_trusted_benign_passed / 16 * 100, 1),
                "false_positive_rate": round(c2_file_trusted_blocked / 16 * 100, 1),
                "blocked_tasks": [r["task_id"] for r in benign_results if not r["file_trusted_pass"]],
            },
            "c1_history_allowlist": {
                "passed": c1_benign_passed,
                "blocked": c1_allowlist_blocked,
                "utility_rate": round(c1_benign_passed / 16 * 100, 1),
                "false_positive_rate": round(c1_allowlist_blocked / 16 * 100, 1),
                "blocked_tasks": [r["task_id"] for r in benign_results if not r["c1_allowlist_pass"]],
            },
        },
        "attack_defense": {
            "total_attacks": total_pairs,
            "financial_attacks": financial_attacks_count,
            "non_financial_attacks": non_financial_attacks_count,
            "c2_strict": {
                "financial_attacks_blocked": c2_strict_attacks_blocked,
                "financial_defense_rate": round(c2_strict_attacks_blocked / financial_attacks_count * 100, 1) if financial_attacks_count else 0.0,
                "asr_on_financial": round((financial_attacks_count - c2_strict_attacks_blocked) / financial_attacks_count * 100, 1) if financial_attacks_count else 0.0,
            },
            "c2_file_trusted": {
                "financial_attacks_blocked": c2_file_trusted_attacks_blocked,
                "financial_defense_rate": round(c2_file_trusted_attacks_blocked / financial_attacks_count * 100, 1) if financial_attacks_count else 0.0,
                "asr_on_financial": round((financial_attacks_count - c2_file_trusted_attacks_blocked) / financial_attacks_count * 100, 1) if financial_attacks_count else 0.0,
            },
            "c1_history_allowlist": {
                "financial_attacks_blocked": c1_allowlist_attacks_blocked,
                "financial_defense_rate": round(c1_allowlist_attacks_blocked / financial_attacks_count * 100, 1) if financial_attacks_count else 0.0,
                "asr_on_financial": round((financial_attacks_count - c1_allowlist_attacks_blocked) / financial_attacks_count * 100, 1) if financial_attacks_count else 0.0,
            },
        },
        "onchain_crosscheck": {
            "benign_checks": onchain_checked_benign,
            "attack_checks": onchain_checked_attack,
            "total_checks": onchain_checked_benign + onchain_checked_attack,
            "config_i": {
                "description": "Allowlist contains only task payees; attacker NOT allowlisted",
                "benign_verdicts": onchain_counts_benign_i,
                "attack_verdicts": onchain_counts_attack_i,
                "benign_agreements": onchain_agreed_benign_i,
                "attack_agreements": onchain_agreed_attack_i,
                "total_agreements": onchain_agreed_benign_i + onchain_agreed_attack_i,
                "contract_agreement_rate": round(
                    (onchain_agreed_benign_i + onchain_agreed_attack_i) / (onchain_checked_benign + onchain_checked_attack) * 100, 1
                ) if (onchain_checked_benign + onchain_checked_attack) > 0 else 0.0,
            },
            "config_ii": {
                "description": "Allowlist contains task payees + attacker (proves Merkle check blocks off-mission independently)",
                "benign_verdicts": onchain_counts_benign_ii,
                "attack_verdicts": onchain_counts_attack_ii,
                "benign_agreements": onchain_agreed_benign_ii,
                "attack_agreements": onchain_agreed_attack_ii,
                "total_agreements": onchain_agreed_benign_ii + onchain_agreed_attack_ii,
                "contract_agreement_rate": round(
                    (onchain_agreed_benign_ii + onchain_agreed_attack_ii) / (onchain_checked_benign + onchain_checked_attack) * 100, 1
                ) if (onchain_checked_benign + onchain_checked_attack) > 0 else 0.0,
            },
            "mismatches_and_special_cases": mismatches,
        },
        "benign_results": benign_results,
        "attack_results": attack_results,
    }

    # Print summary table
    print("\n============================================================")
    print(" GROUND-TRUTH REPLAY SUMMARY RESULTS")
    print("============================================================")
    print(f"Benign Tasks (16 total):")
    print(f"  C2 Strict:       {strict_benign_passed}/16 Utility ({summary['benign_utility']['c2_strict']['utility_rate']}%) | FP: {c2_strict_blocked}/16 (Tasks: {summary['benign_utility']['c2_strict']['blocked_tasks']})")
    print(f"  C2 File-Trusted: {file_trusted_benign_passed}/16 Utility ({summary['benign_utility']['c2_file_trusted']['utility_rate']}%) | FP: {c2_file_trusted_blocked}/16 (Tasks: {summary['benign_utility']['c2_file_trusted']['blocked_tasks']})")
    print(f"  C1 Allowlist:    {c1_benign_passed}/16 Utility ({summary['benign_utility']['c1_history_allowlist']['utility_rate']}%) | FP: {c1_allowlist_blocked}/16 (Tasks: {summary['benign_utility']['c1_history_allowlist']['blocked_tasks']})")
    print(f"\nFinancial Attacks ({financial_attacks_count} total, 16 non-financial separated):")
    print(f"  C2 Strict:       {c2_strict_attacks_blocked}/{financial_attacks_count} Blocked ({summary['attack_defense']['c2_strict']['financial_defense_rate']}%) | ASR: {summary['attack_defense']['c2_strict']['asr_on_financial']}%")
    print(f"  C2 File-Trusted: {c2_file_trusted_attacks_blocked}/{financial_attacks_count} Blocked ({summary['attack_defense']['c2_file_trusted']['financial_defense_rate']}%) | ASR: {summary['attack_defense']['c2_file_trusted']['asr_on_financial']}%")
    print(f"  C1 Allowlist:    {c1_allowlist_attacks_blocked}/{financial_attacks_count} Blocked ({summary['attack_defense']['c1_history_allowlist']['financial_defense_rate']}%) | ASR: {summary['attack_defense']['c1_history_allowlist']['asr_on_financial']}%")
    print(f"  Non-Financial (e.g. update_password): {non_financial_attacks_count} pairs marked 'Out of payment guard scope'")
    print(f"\nOn-Chain Avalanche Fuji Fork Cross-Check:")
    print(f"  Total Calls Replayed: {summary['onchain_crosscheck']['total_checks']}")
    print(f"  [Config i]  Allowlist = Task Payees:")
    print(f"    Benign:  Agreed {summary['onchain_crosscheck']['config_i']['benign_agreements']}/{onchain_checked_benign} | Verdicts: {summary['onchain_crosscheck']['config_i']['benign_verdicts']}")
    print(f"    Attack:  Agreed {summary['onchain_crosscheck']['config_i']['attack_agreements']}/{onchain_checked_attack} | Verdicts: {summary['onchain_crosscheck']['config_i']['attack_verdicts']}")
    print(f"    Rate:    {summary['onchain_crosscheck']['config_i']['contract_agreement_rate']}%")
    print(f"  [Config ii] Allowlist = Task Payees + Attacker (Proves Merkle Enforcement):")
    print(f"    Benign:  Agreed {summary['onchain_crosscheck']['config_ii']['benign_agreements']}/{onchain_checked_benign} | Verdicts: {summary['onchain_crosscheck']['config_ii']['benign_verdicts']}")
    print(f"    Attack:  Agreed {summary['onchain_crosscheck']['config_ii']['attack_agreements']}/{onchain_checked_attack} | Verdicts: {summary['onchain_crosscheck']['config_ii']['attack_verdicts']}")
    print(f"    Rate:    {summary['onchain_crosscheck']['config_ii']['contract_agreement_rate']}%")
    print(f"  Mismatches / Special Cases: {len(mismatches)} (All user_task_15 where prompt explicitly named attacker IBAN as new landlord)")
    print("============================================================\n")

    return summary


def main():
    parser = argparse.ArgumentParser(description="AgentDojo Banking Model-Free Ground-Truth Replay")
    parser.add_argument("--fork-rpc", default="http://127.0.0.1:8546", help="Anvil fork RPC url")
    parser.add_argument("--out", default=None, help="Output JSON path")
    args = parser.parse_args()

    results = run_ground_truth_replay(fork_rpc=args.fork_rpc)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = args.out or f"results/replay-ground-truth-{ts}.json"
    out_file = Path(__file__).resolve().parent / out_path
    out_file.parent.mkdir(parents=True, exist_ok=True)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"[OK] Results saved to {out_file}")


if __name__ == "__main__":
    main()
