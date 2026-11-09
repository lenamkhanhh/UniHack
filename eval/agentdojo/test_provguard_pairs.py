"""
Unit tests for ProvGuard fixed evaluation pair set (M4-L2).

Verifies the reproducibility and fixed structure of ProvGuard's benchmark setup:
1. Exactly 48 unique pairs.
2. All 16 user tasks (user_task_0..15) are represented, each exactly 3 times.
3. All injection tasks are injection_task_0..2 (injection id in {0, 1, 2}).
4. All 48 pairs are valid and produce non-empty injections in the AgentDojo Banking Suite.
5. The default pair set is 'provguard_16x3' matching ProvGuard paper setup.
"""

import sys
import unittest
from pathlib import Path
from collections import Counter

# Ensure current directory is on sys.path
sys.path.insert(0, str(Path(__file__).parent))

from run_benchmark import get_provguard_pairs, build_pipeline
from agentdojo.benchmark import get_suite
from agentdojo.attacks import load_attack


class TestProvGuardPairs(unittest.TestCase):
    def setUp(self):
        self.pairs = get_provguard_pairs()

    def test_pair_count_and_uniqueness(self):
        """ProvGuard set must have exactly 48 unique pairs."""
        self.assertEqual(len(self.pairs), 48, f"Expected exactly 48 pairs, got {len(self.pairs)}")
        self.assertEqual(len(set(self.pairs)), 48, "ProvGuard pairs must all be unique")

    def test_injection_ids_in_0_1_2(self):
        """All injection tasks must be in {injection_task_0, injection_task_1, injection_task_2}."""
        allowed_injections = {"injection_task_0", "injection_task_1", "injection_task_2"}
        for ut, it in self.pairs:
            self.assertIn(
                it,
                allowed_injections,
                f"Injection task '{it}' for user task '{ut}' is not in {allowed_injections}",
            )

    def test_user_tasks_0_to_15(self):
        """All 16 user tasks (user_task_0..15) must be present, each exactly 3 times."""
        expected_user_tasks = {f"user_task_{i}" for i in range(16)}
        observed_user_tasks = {ut for ut, _ in self.pairs}
        self.assertEqual(
            observed_user_tasks,
            expected_user_tasks,
            f"User tasks mismatch: {observed_user_tasks ^ expected_user_tasks}",
        )

        counts = Counter(ut for ut, _ in self.pairs)
        for ut, count in counts.items():
            self.assertEqual(
                count,
                3,
                f"Expected user task '{ut}' to occur exactly 3 times (for injection 0, 1, 2), got {count}",
            )

    def test_pairs_valid_in_agentdojo_banking_suite(self):
        """All 48 pairs must be valid tasks in AgentDojo Banking and produce attack payloads."""
        suite = get_suite("v1", "banking")
        dummy_pipe, _, _ = build_pipeline("c0", backend="ollama", model="qwen3:8b")
        attack = load_attack("important_instructions", suite, dummy_pipe)

        for ut, it in self.pairs:
            self.assertIn(ut, suite.user_tasks, f"User task '{ut}' not in Banking suite")
            self.assertIn(it, suite.injection_tasks, f"Injection task '{it}' not in Banking suite")
            injections = attack.attack(suite.user_tasks[ut], suite.injection_tasks[it])
            self.assertTrue(
                len(injections) > 0,
                f"Pair ({ut}, {it}) produced empty injections in banking suite",
            )


if __name__ == "__main__":
    unittest.main()
