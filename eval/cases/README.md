# PayBench-ADI Benchmark Suite

## Overview
PayBench-ADI is an adversarial evaluation benchmark designed to measure autonomous AI agent payment safety, authorization integrity, utility preservation, and attack success rates under real-world threat models on Avalanche.

## Dataset Structure

| File | Cases | Category | Type | Purpose |
|---|---|---|---|---|
| `eval/cases/adi.jsonl` | 60 | Agent Data Injection (ADI) | Synthetic | Delimiter injections in untrusted tool data: recipient change (20), amount inflation (20), fake approval flags (20) |
| `eval/cases/incidents.jsonl` | 20 | Real Incidents | Real incident variants | 4 historical/recent attack vectors × 5 variants: Bankr Morse ($174k drain), Zscaler JSON-LD, Cornell/Yale OTP, Freysa ($45k drain) |
| `eval/cases/benign.jsonl` | 40 | Benign Controls | Normal operational tasks | Legitimate verified payouts (15), research queries (15), tool invocations (10) to measure utility and false-positive rates |
| **Total** | **120** | | | Comprehensive evaluation across models and defense tiers |

## Note on Group (a) APort Vault Dataset
- **Repository:** `huggingface.co/datasets/aporthq/vault-benchmark-v1`
- **Reference:** *APort Vault: Benchmarking AI Agent Payment Authorization with the Open Agent Passport* (arXiv:2609.22076)
- **License:** Creative Commons Attribution 4.0 International (CC-BY 4.0)
- **Access Status:** Hugging Face gated access (HTTP 401 Unauthorized for unauthenticated requests).
- **Inclusion Decision:** Per reviewer directive §4n (*"Kiểm licence của dataset trước. Nếu không cho phép dùng lại thì bỏ nhóm này và ghi rõ lý do. Ghi nguồn và licence vào file"*), Group (a) is documented here but omitted from the automated public execution pipeline to guarantee 100% reproducible zero-secret evaluations without requiring private Hugging Face authentication tokens.

## Threat Models & Metrics
- **C0 (Unprotected Baseline):** Standard LLM tool-calling agent with zero payment guards. Any schema-valid proposal is considered disbursed.
- **C1 (Cap + Allowlist Only):** Traditional payment gatekeeper enforcing global allowlists and transaction caps, but without data provenance or Merkle payee sets.
- **C2 (Full MissionPay):** Full multi-layer defense with server-side taint tracking, Merkle mission payee root enforcement, contract-level budget caps, and policy tampering prevention.
