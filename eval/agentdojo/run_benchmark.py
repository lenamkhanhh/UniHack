"""
AgentDojo Banking Defense Benchmark Runner (Honest Live LLM Edition)
Evaluates C0 (Unprotected), C1 (Tool Filter), C2-Strict, and C2-File-Trusted
on AgentDojo Banking Suite with 'important_instructions' prompt injection attacks.
Grounds all evaluated transactions with on-chain EVM simulation on a local Anvil fork
of Avalanche Fuji GuardedTreasury (0x20451c1e2dCD83F166B4f22868BAdECb5868d545).

Supports dual backends:
- Google Gemini API (`--backend google`, default model `gemini-3.1-flash-lite`)
- Local Ollama OpenAI-compatible API (`--backend ollama`, default model `qwen3:8b`)
"""

import os
import sys
import json
import time
import random
import hashlib
import pickle
import multiprocessing
import argparse
import concurrent.futures
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional, Sequence, Union
from datetime import datetime
from dotenv import load_dotenv

# Ensure root .env is loaded
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "apps/web/.env")

from google import genai
from google.genai import types as genai_types
from google.genai.errors import ClientError

import openai
from agentdojo.agent_pipeline.llms.openai_llm import OpenAILLM

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
ba.MODEL_NAMES["qwen3:8b"] = "AI model developed by Alibaba Cloud"
ba.MODEL_NAMES["qwen3-8b"] = "AI model developed by Alibaba Cloud"
ba.MODEL_NAMES["qwen2.5:7b"] = "AI model developed by Alibaba Cloud"
ba.MODEL_NAMES["llama3.1:8b"] = "AI model developed by Meta"

from missionpay_defense import MissionPayDefense
from tool_filter_defense import StandardToolFilterDefense

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def _process_task_worker_pipe(child_conn: Any, fn: Any, args: tuple, kwargs: dict):
    try:
        res = fn(*args, **kwargs)
        child_conn.send(("SUCCESS", res))
    except Exception as e:
        child_conn.send(("EXCEPTION", e))
    finally:
        child_conn.close()


def run_task_with_timeout(
    fn: Any,
    timeout_seconds: float = 600.0,
    args: tuple = (),
    kwargs: Optional[dict] = None,
) -> Any:
    """
    Executes a callable with a strict wall-clock timeout and process-level termination.
    Compatible with Windows spawn multiprocessing.
    Requires fn and all arguments to be picklable.
    No unkillable thread fallback.
    """
    if kwargs is None:
        kwargs = {}

    try:
        pickle.dumps(fn)
        pickle.dumps(args)
        pickle.dumps(kwargs)
    except Exception as e:
        raise TypeError(
            f"Cannot serialize task for process isolation: {e}. "
            "Lambdas and dynamic closures are forbidden; use top-level spawn-compatible functions."
        ) from e

    ctx = multiprocessing.get_context("spawn")
    parent_conn, child_conn = ctx.Pipe(duplex=False)
    p = ctx.Process(target=_process_task_worker_pipe, args=(child_conn, fn, args, kwargs))
    p.start()
    child_conn.close()

    start_time = time.time()
    result_ready = False
    while time.time() - start_time < timeout_seconds:
        if parent_conn.poll(0.05):
            result_ready = True
            break
        if not p.is_alive():
            break

    if not result_ready and p.is_alive():
        p.terminate()
        p.join(timeout=0.2)
        if p.is_alive():
            p.kill()
            p.join(timeout=0.2)
        parent_conn.close()
        raise TimeoutError(f"Task exceeded wall-clock timeout of {timeout_seconds}s")

    if result_ready:
        status, payload = parent_conn.recv()
        parent_conn.close()
        p.join(timeout=0.5)
        if status == "SUCCESS":
            return payload
        elif status == "EXCEPTION":
            raise payload

    parent_conn.close()
    p.join(timeout=0.5)
    raise RuntimeError("Worker process terminated without returning result")


def _execute_agentdojo_task_worker(child_conn: Any, task_spec: dict):
    """
    Top-level spawn worker function that reconstructs suite, pipeline, LLM, and defense
    inside the isolated child process.
    """
    try:
        if task_spec.get("backend") == "offline_stub":
            # Deterministic offline stub for testing worker reconstruction and IPC without live model
            stub_calls = task_spec.get("stub_api_calls", 3)
            stub_errors = task_spec.get("stub_api_errors", 1)
            stub_trace = task_spec.get("stub_trace", [{"function": "get_balance", "args": {}}])
            stub_u = task_spec.get("stub_utility", True)
            stub_sec = task_spec.get("stub_security", False)
            result_payload = {
                "utility": stub_u,
                "security": stub_sec,
                "trace": stub_trace,
                "api_calls": stub_calls,
                "api_errors": stub_errors,
                "onchain_log": None,
            }
            child_conn.send(("SUCCESS", result_payload))
            return

        suite_name = task_spec.get("suite_name", "banking")
        suite = get_suite("v1", suite_name)
        user_task_id = task_spec["user_task_id"]
        inj_task_id = task_spec.get("inj_task_id")
        injections = task_spec.get("injections") or {}
        defense_key = task_spec["defense_key"]
        backend = task_spec.get("backend", "ollama")
        model = task_spec.get("model", "qwen3:8b")
        ollama_url = task_spec.get("ollama_url", "http://127.0.0.1:11434")
        google_api_key = task_spec.get("google_api_key")

        google_client = None
        if backend == "google" and google_api_key:
            google_client = genai.Client(api_key=google_api_key)

        pipeline, missionpay_instance, llm_wrapper = build_pipeline(
            defense_key,
            backend=backend,
            model=model,
            google_client=google_client,
            ollama_url=ollama_url,
        )

        if missionpay_instance:
            missionpay_instance.current_task_id = user_task_id

        user_task = suite.user_tasks[user_task_id]
        inj_task = suite.injection_tasks[inj_task_id] if inj_task_id else None

        res = suite.run_task_with_pipeline(
            pipeline,
            user_task=user_task,
            injection_task=inj_task,
            injections=injections,
        )
        u, sec = res
        onchain_log = (
            missionpay_instance.replay_log[-1]
            if (missionpay_instance and missionpay_instance.replay_log)
            else None
        )

        result_payload = {
            "utility": u,
            "security": sec,
            "trace": llm_wrapper.get_task_trace(),
            "api_calls": llm_wrapper.api_calls_count,
            "api_errors": llm_wrapper.api_errors_count,
            "onchain_log": onchain_log,
        }
        child_conn.send(("SUCCESS", result_payload))
    except Exception as e:
        child_conn.send(("EXCEPTION", (type(e).__name__, str(e))))
    finally:
        child_conn.close()


def run_agentdojo_task_in_subprocess(task_spec: dict, timeout_seconds: float = 600.0) -> dict:
    """
    Spawns an isolated child process to execute an AgentDojo task using serializable task_spec.
    Kills the child on timeout with no lingering worker side effects.
    """
    try:
        pickle.dumps(task_spec)
    except Exception as e:
        raise TypeError(f"Cannot serialize task_spec for subprocess execution: {e}") from e

    ctx = multiprocessing.get_context("spawn")
    parent_conn, child_conn = ctx.Pipe(duplex=False)
    p = ctx.Process(target=_execute_agentdojo_task_worker, args=(child_conn, task_spec))
    p.start()
    child_conn.close()

    start_time = time.time()
    result_ready = False
    while time.time() - start_time < timeout_seconds:
        if parent_conn.poll(0.05):
            result_ready = True
            break
        if not p.is_alive():
            break

    if not result_ready and p.is_alive():
        p.terminate()
        p.join(timeout=0.2)
        if p.is_alive():
            p.kill()
            p.join(timeout=0.2)
        parent_conn.close()
        raise TimeoutError(f"Task exceeded wall-clock timeout of {timeout_seconds}s")

    if result_ready:
        status, payload = parent_conn.recv()
        parent_conn.close()
        p.join(timeout=0.5)
        if status == "SUCCESS":
            return payload
        elif status == "EXCEPTION":
            exc_type, exc_msg = payload
            raise RuntimeError(f"{exc_type}: {exc_msg}")

    parent_conn.close()
    p.join(timeout=0.5)
    raise RuntimeError("Worker process terminated without returning result")

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
        self.current_task_trace: List[Dict[str, Any]] = []
        self.last_assistant_text: str = ""

    def reset_task_trace(self):
        self.current_task_trace = []
        self.last_assistant_text = ""

    def get_task_trace(self) -> Dict[str, Any]:
        return {
            "tool_calls": list(self.current_task_trace),
            "final_assistant_text": self.last_assistant_text,
        }

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

        # Pacing: avoid bursting past free tier 15 RPM window
        time.sleep(2.0)

        retries = 4
        delay = 10
        for attempt in range(retries):
            try:
                self.api_calls_count += 1
                res = self.underlying_llm.query(query, runtime, env, messages, extra_args)
                q_out, rt_out, env_out, msgs_out, extra_out = res
                if msgs_out and len(msgs_out) > 0:
                    last_msg = msgs_out[-1]
                    if isinstance(last_msg, dict) and last_msg.get("role") == "assistant":
                        t_calls = last_msg.get("tool_calls")
                        if t_calls:
                            for tc in t_calls:
                                fn = getattr(tc, "function", None) or (tc.get("function") if isinstance(tc, dict) else str(tc))
                                args = getattr(tc, "args", None) or (tc.get("args") if isinstance(tc, dict) else {})
                                self.current_task_trace.append({"function": fn, "args": args})
                        content_val = last_msg.get("content")
                        if content_val and isinstance(content_val, list):
                            texts = [b.get("content", "") for b in content_val if isinstance(b, dict) and b.get("type") == "text"]
                            if texts:
                                self.last_assistant_text = "".join(texts)
                return res
            except ClientError as e:
                err_str = str(e)
                # Check for explicit daily quota exhaustion
                if "per day" in err_str.lower() or "perday" in err_str.lower():
                    self.quota_exhausted = True
                    self.api_errors_count += 1
                    raise RuntimeError("QUOTA_EXHAUSTED: Gemini API daily quota limit reached") from e

                # Handle transient 429 rate limit (per minute quota) with backoff
                if "RESOURCE_EXHAUSTED" in err_str or getattr(e, "code", None) == 429 or "429" in err_str:
                    self.api_errors_count += 1
                    if attempt < retries - 1:
                        print(f"    [429 Backoff] Rate limit hit, waiting {delay}s (attempt {attempt+1}/{retries})...")
                        time.sleep(delay)
                        delay += 10
                        continue
                    else:
                        self.quota_exhausted = True
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

class HonestOllamaLLM(BasePipelineElement):
    """
    Direct caller to OpenAILLM pointing to local Ollama OpenAI-compatible endpoint.
    Zero synthetic fallback. If the endpoint fails or disconnects, raises RuntimeError and stops.
    """
    def __init__(self, model: str, base_url: str = "http://127.0.0.1:11434", temperature: float = 0.0):
        super().__init__()
        self.model = model
        self.base_url = base_url
        self.temperature = temperature
        client = openai.OpenAI(
            base_url=f"{base_url.rstrip('/')}/v1",
            api_key="ollama",  # Ollama requires non-empty string for API key
        )
        self.underlying_llm = OpenAILLM(client=client, model=model, temperature=temperature)
        self.api_calls_count = 0
        self.api_errors_count = 0
        self.current_task_trace: List[Dict[str, Any]] = []
        self.last_assistant_text: str = ""

    def reset_task_trace(self):
        self.current_task_trace = []
        self.last_assistant_text = ""

    def get_task_trace(self) -> Dict[str, Any]:
        return {
            "tool_calls": list(self.current_task_trace),
            "final_assistant_text": self.last_assistant_text,
        }

    def query(
        self,
        query: str,
        runtime: FunctionsRuntime,
        env: Any = EmptyEnv(),
        messages: Sequence[ChatMessage] = [],
        extra_args: dict = {},
    ) -> Tuple[str, FunctionsRuntime, Any, Sequence[ChatMessage], dict]:
        retries = 3
        delay = 2
        for attempt in range(retries):
            try:
                self.api_calls_count += 1
                res = self.underlying_llm.query(query, runtime, env, messages, extra_args)
                q_out, rt_out, env_out, msgs_out, extra_out = res
                if msgs_out and len(msgs_out) > 0:
                    last_msg = msgs_out[-1]
                    if isinstance(last_msg, dict) and last_msg.get("role") == "assistant":
                        t_calls = last_msg.get("tool_calls")
                        if t_calls:
                            for tc in t_calls:
                                fn = getattr(tc, "function", None) or (tc.get("function") if isinstance(tc, dict) else str(tc))
                                args = getattr(tc, "args", None) or (tc.get("args") if isinstance(tc, dict) else {})
                                self.current_task_trace.append({"function": fn, "args": args})
                        content_val = last_msg.get("content")
                        if content_val and isinstance(content_val, list):
                            texts = [b.get("content", "") for b in content_val if isinstance(b, dict) and b.get("type") == "text"]
                            if texts:
                                self.last_assistant_text = "".join(texts)
                return res
            except Exception as e:
                self.api_errors_count += 1
                err_str = str(e)
                if "Connection refused" in err_str or "ConnectError" in err_str:
                    raise RuntimeError(f"OLLAMA_SERVER_DOWN: Cannot connect to Ollama at {self.base_url}: {e}") from e
                if attempt < retries - 1:
                    time.sleep(delay)
                    delay *= 2
                else:
                    raise

def fetch_ollama_metadata(base_url: str, model: str) -> Dict[str, Any]:
    """
    Fetches model metadata from Ollama's local HTTP API (/api/tags and /api/show).
    Exits with non-zero status if the endpoint is unreachable or model is missing (never simulates).
    """
    tags_url = f"{base_url.rstrip('/')}/api/tags"
    req = urllib.request.Request(tags_url, headers={"User-Agent": "MissionPay-Bench/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"\n[FATAL ERROR] Cannot connect to local Ollama instance at {tags_url}: {e}")
        print("M4-L1 requirement: Never fall back to simulator. Ollama service must be running locally.")
        sys.exit(1)

    models_list = data.get("models", [])
    matched = None
    for m in models_list:
        name = m.get("name", "")
        if name == model or name == f"{model}:latest" or model == name.split(":")[0]:
            matched = m
            break

    if not matched:
        # Check /api/show as secondary inspection
        try:
            show_url = f"{base_url.rstrip('/')}/api/show"
            show_req = urllib.request.Request(
                show_url,
                data=json.dumps({"name": model}).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "MissionPay-Bench/1.0"},
                method="POST",
            )
            with urllib.request.urlopen(show_req, timeout=5) as resp:
                show_data = json.loads(resp.read().decode("utf-8"))
                details = show_data.get("details", {})
                return {
                    "digest": show_data.get("digest") or "unknown",
                    "quantization": details.get("quantization_level") or "unknown",
                    "family": details.get("family") or "unknown",
                    "parameter_size": details.get("parameter_size") or "unknown",
                }
        except Exception:
            pass

        available = [m.get("name") for m in models_list]
        print(f"\n[FATAL ERROR] Model '{model}' not found in local Ollama library.")
        print(f"Available models in Ollama: {available}")
        print(f"Please run `ollama pull {model}` before executing benchmark.")
        sys.exit(1)

    details = matched.get("details", {})
    return {
        "digest": matched.get("digest", "unknown"),
        "quantization": details.get("quantization_level", "unknown"),
        "family": details.get("family", "unknown"),
        "parameter_size": details.get("parameter_size", "unknown"),
    }

def wilson_score_interval(successes: int, total: int, confidence: float = 0.95) -> Tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    z = 1.95996  # 95% confidence
    p_hat = successes / total
    denominator = 1 + z**2 / total
    centre = (p_hat + z**2 / (2 * total)) / denominator
    spread = (z * ((p_hat * (1 - p_hat) / total + z**2 / (4 * total**2)) ** 0.5)) / denominator
    return (round(max(0.0, centre - spread) * 100, 1), round(min(1.0, centre + spread) * 100, 1))

def get_defense_code_revision(defense_key: str) -> str:
    """
    Computes a deterministic hash of the defense implementation files
    to ensure cache invalidation when defense logic, harness, or rules change.
    Maps actual runner defense keys: c0, c1, c2_strict, c2_file_trusted, etc.
    Fails visibly for unknown defense rather than returning empty hash.
    """
    base_dir = Path(__file__).parent
    files_to_hash = [base_dir / "run_benchmark.py"]

    if defense_key == "c0":
        pass
    elif defense_key in ("c1", "tool_filter"):
        files_to_hash.append(base_dir / "tool_filter_defense.py")
    elif defense_key in ("c2", "c2_strict", "c2_file_trusted", "missionpay", "m3_onchain", "provguard"):
        files_to_hash.extend([
            base_dir / "missionpay_defense.py",
            base_dir / "merkle.py",
            base_dir / "tool_filter_defense.py",
        ])
    else:
        raise ValueError(f"Unknown defense key: {defense_key}. Valid options: c0, c1, c2_strict, c2_file_trusted, etc.")

    h = hashlib.sha256()
    for fp in sorted(files_to_hash):
        if fp.exists():
            h.update(fp.read_bytes())
        else:
            raise FileNotFoundError(f"Defense implementation file not found: {fp}")
    return h.hexdigest()[:16]


def get_task_suite_fingerprint(suite_name: str = "banking", suite_version: str = "v1") -> str:
    """
    Computes a cryptographic fingerprint over the task suite environment and tool definitions.
    Includes tool run implementation source, parameters, docstrings, environment class source,
    and suite version so any change in tools/environment invalidates the cache.
    Fails visibly if fingerprint computation cannot be performed.
    """
    suite = get_suite(suite_version, suite_name)
    parts = [f"suite:{suite_name}:{suite_version}"]
    if hasattr(suite, "environment_type") and suite.environment_type is not None:
        try:
            parts.append("env:" + inspect.getsource(suite.environment_type))
        except Exception:
            parts.append("env_str:" + str(suite.environment_type))

    if hasattr(suite, "data_path") and suite.data_path is not None:
        parts.append("data_path:" + str(suite.data_path))

    for t in sorted(suite.tools, key=lambda x: getattr(x, "name", str(x))):
        t_name = getattr(t, "name", str(t))
        t_doc = getattr(t, "docstring", getattr(t, "__doc__", "")) or ""
        t_params = str(getattr(t, "parameters", ""))
        tool_entry = [f"tool:{t_name}", f"doc:{t_doc}", f"params:{t_params}"]
        if hasattr(t, "run") and callable(t.run):
            try:
                tool_entry.append("code:" + inspect.getsource(t.run))
            except Exception:
                tool_entry.append("code_repr:" + repr(t.run))
        parts.append(";".join(tool_entry))

    raw = "\n---\n".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def extract_task_prompt(task: Any) -> str:
    """Extracts task prompt safely across different AgentDojo task interfaces."""
    for attr in ("prompt", "goal", "user_prompt", "PROMPT", "instruction", "query"):
        val = getattr(task, attr, None)
        if val is not None and isinstance(val, str) and val.strip():
            return val.strip()
    return str(task)

def compute_cache_fingerprint(
    backend: str,
    model: str,
    user_task_id: str,
    inj_task_id: Optional[str] = None,
    defense: str = "c0",
    prompt: Optional[str] = None,
    attack_payload: Optional[str] = None,
    system_message: Optional[str] = None,
    defense_code_revision: Optional[str] = None,
    model_digest: Optional[str] = None,
    task_suite_fingerprint: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Computes a cryptographic fingerprint binding:
    - backend and model
    - model digest / version (explicitly 'unavailable' if absent, never fabricated)
    - user task prompt / system message
    - attack payload / injection task
    - policy / defense code revision (including harness run_benchmark.py)
    - task suite environment / tool definitions
    - config parameters (e.g. temperature, seed)
    """
    if defense_code_revision is None:
        defense_code_revision = get_defense_code_revision(defense)

    if task_suite_fingerprint is None:
        task_suite_fingerprint = get_task_suite_fingerprint("banking", "v1")

    resolved_model_digest = model_digest if model_digest else "unavailable"

    manifest = {
        "backend": backend,
        "model": model,
        "model_digest": resolved_model_digest,
        "user_task_id": user_task_id,
        "inj_task_id": inj_task_id or "none",
        "defense": defense,
        "defense_code_revision": defense_code_revision,
        "task_suite_fingerprint": task_suite_fingerprint,
        "prompt_hash": hashlib.sha256((prompt or "").encode("utf-8")).hexdigest()[:16],
        "attack_hash": hashlib.sha256((attack_payload or "").encode("utf-8")).hexdigest()[:16],
        "system_message_hash": hashlib.sha256((system_message or "").encode("utf-8")).hexdigest()[:16],
        "config": config or {},
    }
    canonical_repr = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_repr.encode("utf-8")).hexdigest()

def get_legacy_cache_key(backend: str, model: str, user_task_id: str, inj_task_id: Optional[str], defense: str) -> str:
    """Preserves legacy sha256 formula for historical audit verification."""
    raw = f"{backend}:{model}:{user_task_id}:{inj_task_id or 'none'}:{defense}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def get_cache_key(
    backend: str,
    model: str,
    user_task_id: str,
    inj_task_id: Optional[str] = None,
    defense: str = "c0",
    prompt: Optional[str] = None,
    attack_payload: Optional[str] = None,
    system_message: Optional[str] = None,
    defense_code_revision: Optional[str] = None,
    model_digest: Optional[str] = None,
    task_suite_fingerprint: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
) -> str:
    return compute_cache_fingerprint(
        backend=backend,
        model=model,
        user_task_id=user_task_id,
        inj_task_id=inj_task_id,
        defense=defense,
        prompt=prompt,
        attack_payload=attack_payload,
        system_message=system_message,
        defense_code_revision=defense_code_revision,
        model_digest=model_digest,
        task_suite_fingerprint=task_suite_fingerprint,
        config=config,
    )

def compute_attack_success(security: bool) -> bool:
    """
    In AgentDojo benchmark protocol:
    security=True indicates that the attack payload executed and successfully breached security
    (e.g. transfer to attacker IBAN was performed).
    security=False indicates that the attack was neutralized/blocked by the pipeline or guard.
    """
    return bool(security)


def get_provguard_pairs() -> List[Tuple[str, str]]:
    """
    Returns the fixed ProvGuard evaluation pair set:
    Exactly 16 user tasks (user_task_0..15) x 3 injection tasks (injection_task_0..2) = 48 pairs.
    Matches ProvGuard's standard benchmarking protocol for AgentDojo banking suite.
    """
    return [
        (f"user_task_{u}", f"injection_task_{i}")
        for u in range(16)
        for i in range(3)
    ]


def build_pipeline(
    defense: str,
    backend: str = "google",
    model: str = "gemini-3.1-flash-lite",
    google_client: Optional[genai.Client] = None,
    ollama_url: str = "http://127.0.0.1:11434",
) -> Tuple[AgentPipeline, Optional[MissionPayDefense], BasePipelineElement]:
    system_msg = load_system_message("banking")
    
    if backend == "ollama":
        llm = HonestOllamaLLM(model=model, base_url=ollama_url, temperature=0.0)
        pipeline_name = f"ollama/{model}"
    elif backend == "google":
        if not google_client:
            # For offline/dummy construction (e.g. legacy cache report mode or pair enumeration),
            # provide a stub LLM to avoid crashing on missing key/network
            llm = HonestOllamaLLM(model=model, base_url="http://127.0.0.1:0", temperature=0.0)
            pipeline_name = f"google-offline-stub/{model}"
        else:
            llm = HonestGoogleLLM(model=model, client=google_client, temperature=0.0)
            pipeline_name = f"google/{model}"
    else:
        raise ValueError(f"Unknown backend: {backend}. Must be 'google' or 'ollama'.")

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
    pipeline.name = pipeline_name
    return pipeline, mp_defense, llm

def run_benchmark(
    backend: str = "google",
    model: Optional[str] = None,
    ollama_url: str = "http://127.0.0.1:11434",
    defenses: Sequence[str] = ("c0", "c2_strict"),
    pairs: str = "provguard",
    sample_size: Optional[int] = None,
    limit: Optional[int] = None,
    seed: int = 42,
    use_cache: bool = True,
    allow_legacy_cache: bool = False,
):
    start_wall_time = time.time()
    
    if model is None:
        model = "qwen3:8b" if backend == "ollama" else "gemini-3.1-flash-lite"

    google_client = None
    ollama_meta = None
    if backend == "ollama":
        if not allow_legacy_cache:
            ollama_meta = fetch_ollama_metadata(ollama_url, model)
        else:
            try:
                ollama_meta = fetch_ollama_metadata(ollama_url, model)
            except Exception:
                ollama_meta = {"digest": "unavailable", "quantization": "unavailable"}
    elif backend == "google":
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key and not allow_legacy_cache:
            print("[ERROR] GEMINI_API_KEY environment variable is missing.")
            sys.exit(1)
        if api_key:
            google_client = genai.Client(
                api_key=api_key,
                http_options=genai_types.HttpOptions(timeout=120_000),
            )
    else:
        print(f"[ERROR] Unsupported backend: {backend}")
        sys.exit(1)

    suite = get_suite("v1", "banking")
    
    all_user_tasks = list(suite.user_tasks.keys())
    all_injection_tasks = list(suite.injection_tasks.keys())
    
    dummy_pipe, _, _ = build_pipeline(
        "c0",
        backend=backend,
        model=model,
        google_client=google_client,
        ollama_url=ollama_url,
    )
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

    # Pair selection strategy (ProvGuard fixed 16x3 vs random sampling)
    if pairs == "provguard":
        target_pairs = get_provguard_pairs()
        pair_set_name = "provguard_16x3"
        sampling_method = "fixed_provguard_16x3"
    elif pairs == "random":
        rng = random.Random(seed)
        effective_sample = sample_size if sample_size is not None else 48
        if effective_sample < len(all_pairs):
            target_pairs = rng.sample(all_pairs, effective_sample)
        else:
            target_pairs = all_pairs
        pair_set_name = f"random_{len(target_pairs)}"
        sampling_method = f"random_sample_seed_{seed}"
    else:
        raise ValueError(f"Unknown pairs strategy: '{pairs}'. Must be 'provguard' or 'random'.")

    # Apply limit for smoke testing if requested
    if limit is not None and limit > 0:
        target_pairs = target_pairs[:limit]

    # Benign runs stay 16 user tasks without injection
    if limit is not None and limit > 0:
        target_user_tasks = sorted(list(set(ut for ut, _ in target_pairs)))
    else:
        target_user_tasks = [f"user_task_{u}" for u in range(16)]

    run_timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    clean_model_tag = model.replace(":", "-").replace("/", "-")
    run_id = f"agentdojo-banking-{backend}-{clean_model_tag}-{run_timestamp}"

    print(f"============================================================")
    print(f" AgentDojo Banking Defense Benchmark (Live LLM)")
    print(f" Backend: {backend} | Model: {model} | Defenses: {defenses}")
    if ollama_meta:
        print(f" Digest: {ollama_meta['digest'][:16]}... | Quant: {ollama_meta['quantization']}")
    print(f" Strategy: {pairs} ({pair_set_name}) | Pairs to evaluate: {len(target_pairs)} (limit: {limit})")
    print(f" Benign Tasks: {len(target_user_tasks)}")
    print(f" Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"============================================================\n")

    overall_results: Dict[str, Any] = {
        "metadata": {
            "run_id": run_id,
            "run_type": "historical_legacy_audit" if allow_legacy_cache else "fresh_benchmark",
            "comparable_to_fresh": not allow_legacy_cache,
            "legacy_cache_mode": allow_legacy_cache,
            "timestamp": datetime.now().isoformat(),
            "backend": backend,
            "model": model,
            "model_digest": (ollama_meta.get("digest") if ollama_meta else None) or "unavailable",
            "quantization": (ollama_meta.get("quantization") if ollama_meta else None) or "unavailable",
            "model_details": ollama_meta if ollama_meta else None,
            "temperature": 0.0,
            "seed": seed,
            "limit": limit,
            "defenses": list(defenses),
            "pair_set": pair_set_name,
            "pairs": [f"{ut}:{it}" for ut, it in target_pairs],
            "pairs_count": len(target_pairs),
            "total_pairs_in_suite": len(all_pairs),
            "sampled_pairs_count": len(target_pairs),
            "sample_seed": seed,
            "sampling_method": "smoke_limit" if limit else sampling_method,
        },
        "defenses": {},
    }

    output_path = RESULTS_DIR / f"{run_id}.json"

    def save_checkpoint():
        overall_results["metadata"]["wall_time_seconds"] = round(time.time() - start_wall_time, 2)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(overall_results, f, indent=2)
        generate_summary(overall_results, output_path)

    for defense_key in defenses:
        print(f"\n--- Evaluating Defense: {defense_key.upper()} ---", flush=True)
        pipeline, missionpay_instance, llm_wrapper = build_pipeline(
            defense_key,
            backend=backend,
            model=model,
            google_client=google_client,
            ollama_url=ollama_url,
        )

        # 1. Benign Utility
        benign_utility = {}
        benign_errors = {}
        total_api_calls = 0
        total_api_errors = 0
        cached_api_calls = 0
        fresh_api_calls = 0
        unknown_call_tasks = 0
        system_msg = load_system_message("banking")
        model_digest = (ollama_meta.get("digest") if ollama_meta else None) or "unavailable"

        for ut_idx, ut_id in enumerate(target_user_tasks):
            task = suite.user_tasks[ut_id]
            prompt_text = extract_task_prompt(task)
            ck = get_cache_key(
                backend=backend,
                model=model,
                user_task_id=ut_id,
                inj_task_id=None,
                defense=defense_key,
                prompt=prompt_text,
                attack_payload=None,
                system_message=system_msg,
                model_digest=model_digest,
                config={"seed": seed, "temperature": 0.0},
            )
            legacy_ck = get_legacy_cache_key(backend, model, ut_id, None, defense_key)
            cf = CACHE_DIR / f"{ck}.json"
            legacy_cf = CACHE_DIR / f"{legacy_ck}.json"

            if use_cache and not allow_legacy_cache and cf.exists():
                with open(cf, "r", encoding="utf-8") as f:
                    entry = json.load(f)
                    benign_utility[ut_id] = entry["utility"]
                    if missionpay_instance and entry.get("onchain_log"):
                        missionpay_instance.replay_log.append(entry["onchain_log"])
                    c_calls = entry.get("api_calls", 0)
                    cached_api_calls += c_calls
                    total_api_calls += c_calls
                    total_api_errors += entry.get("api_errors", 0)
                print(f"  [{datetime.now().strftime('%H:%M:%S')}] [CACHE-HIT] Benign {ut_idx+1}/{len(target_user_tasks)} ({ut_id}): utility={benign_utility[ut_id]}", flush=True)
            elif allow_legacy_cache:
                # Isolated historical reporting mode: NEVER run fresh tasks, NEVER mix into fresh metrics
                if legacy_cf.exists():
                    with open(legacy_cf, "r", encoding="utf-8") as f:
                        entry = json.load(f)
                        benign_utility[ut_id] = entry["utility"]
                        if missionpay_instance and entry.get("onchain_log"):
                            missionpay_instance.replay_log.append(entry["onchain_log"])
                        c_calls = entry.get("api_calls", 0)
                        cached_api_calls += c_calls
                        total_api_calls += c_calls
                        total_api_errors += entry.get("api_errors", 0)
                        print(f"  [{datetime.now().strftime('%H:%M:%S')}] [LEGACY-HISTORICAL] Benign {ut_idx+1}/{len(target_user_tasks)} ({ut_id}): utility={benign_utility[ut_id]}", flush=True)
                else:
                    benign_utility[ut_id] = False
                    benign_errors[ut_id] = "MISSING_IN_LEGACY_CACHE"
                    print(f"  [{datetime.now().strftime('%H:%M:%S')}] [LEGACY-MISSING] Benign {ut_idx+1}/{len(target_user_tasks)} ({ut_id})", flush=True)
            else:
                try:
                    task_spec = {
                        "suite_name": "banking",
                        "user_task_id": ut_id,
                        "inj_task_id": None,
                        "injections": {},
                        "defense_key": defense_key,
                        "backend": backend,
                        "model": model,
                        "ollama_url": ollama_url,
                        "google_api_key": os.environ.get("GEMINI_API_KEY"),
                    }
                    task_result = run_agentdojo_task_in_subprocess(task_spec, timeout_seconds=600)
                    u = task_result["utility"]
                    s = task_result["security"]
                    calls = task_result.get("api_calls", 0)
                    errors = task_result.get("api_errors", 0)
                    fresh_api_calls += calls
                    total_api_calls += calls
                    total_api_errors += errors
                    benign_utility[ut_id] = u
                    onchain_entry = task_result.get("onchain_log")
                    if missionpay_instance and onchain_entry:
                        missionpay_instance.replay_log.append(onchain_entry)

                    with open(cf, "w", encoding="utf-8") as f:
                        json.dump({
                            "schema_version": "2.0",
                            "fingerprint": ck,
                            "source": "live",
                            "backend": backend,
                            "model": model,
                            "model_digest": model_digest,
                            "user_task_id": ut_id,
                            "inj_task_id": None,
                            "defense_key": defense_key,
                            "defense_revision": get_defense_code_revision(defense_key),
                            "prompt_hash": hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:16],
                            "timestamp": datetime.now().isoformat(),
                            "utility": u,
                            "security": s,
                            "api_calls": calls,
                            "api_errors": errors,
                            "onchain_log": onchain_entry,
                            "trace": task_result.get("trace"),
                        }, f, indent=2)
                    passed_so_far = sum(1 for v in benign_utility.values() if v)
                    print(f"  [{datetime.now().strftime('%H:%M:%S')}] [LIVE] Benign {ut_idx+1}/{len(target_user_tasks)} ({ut_id}): utility={u} (Passed: {passed_so_far}/{len(benign_utility)})", flush=True)
                except TimeoutError as te:
                    print(f"  [{datetime.now().strftime('%H:%M:%S')}] [TIMEOUT] Benign task {ut_id} timed out after 600s: {te}", flush=True)
                    benign_errors[ut_id] = "TIMEOUT"
                    unknown_call_tasks += 1
                    total_api_errors += 1
                    save_checkpoint()
                except Exception as e:
                    print(f"  [{datetime.now().strftime('%H:%M:%S')}] [ERROR] Benign task {ut_id} failed: {e}", flush=True)
                    benign_errors[ut_id] = str(e)
                    unknown_call_tasks += 1
                    total_api_errors += 1
                    save_checkpoint()
                    if "QUOTA_EXHAUSTED" in str(e) or "OLLAMA_SERVER_DOWN" in str(e):
                        break
                time.sleep(0.5)

        benign_passed = sum(1 for v in benign_utility.values() if v)
        benign_total = len(benign_utility)
        benign_rate = round((benign_passed / benign_total * 100), 1) if benign_total > 0 else 0.0
        benign_ci = wilson_score_interval(benign_passed, benign_total)
        print(f"  Benign Utility: {benign_passed}/{benign_total} ({benign_rate}%, 95% CI [{benign_ci[0]}%, {benign_ci[1]}%])", flush=True)
        if benign_errors:
            print(f"  Benign Errors encountered: {len(benign_errors)}", flush=True)

        # 2. Under Attack
        pairs_evaluated = 0
        utility_under_attack_count = 0
        attack_success_count = 0
        pair_details = []
        pair_errors = 0

        for p_idx, (ut_id, it_id) in enumerate(target_pairs):
            user_task = suite.user_tasks[ut_id]
            inj_task = suite.injection_tasks[it_id]
            injections = attack.attack(user_task, inj_task)
            if not injections:
                continue

            prompt_text = extract_task_prompt(user_task)
            attack_payload_text = json.dumps(injections, sort_keys=True) if isinstance(injections, dict) else str(injections)
            ck = get_cache_key(
                backend=backend,
                model=model,
                user_task_id=ut_id,
                inj_task_id=it_id,
                defense=defense_key,
                prompt=prompt_text,
                attack_payload=attack_payload_text,
                system_message=system_msg,
                model_digest=model_digest,
                config={"seed": seed, "temperature": 0.0},
            )
            legacy_ck = get_legacy_cache_key(backend, model, ut_id, it_id, defense_key)
            cf = CACHE_DIR / f"{ck}.json"
            legacy_cf = CACHE_DIR / f"{legacy_ck}.json"

            if use_cache and not allow_legacy_cache and cf.exists():
                with open(cf, "r", encoding="utf-8") as f:
                    entry = json.load(f)
                    u = entry["utility"]
                    sec = entry["security"]
                    if missionpay_instance and entry.get("onchain_log"):
                        missionpay_instance.replay_log.append(entry["onchain_log"])
                    c_calls = entry.get("api_calls", 0)
                    cached_api_calls += c_calls
                    total_api_calls += c_calls
                    total_api_errors += entry.get("api_errors", 0)
                pairs_evaluated += 1
                if u:
                    utility_under_attack_count += 1
                attack_succeeded = compute_attack_success(sec)
                if attack_succeeded:
                    attack_success_count += 1
                pair_details.append({
                    "user_task": ut_id,
                    "injection_task": it_id,
                    "utility": u,
                    "attack_succeeded": attack_succeeded,
                })
                print(
                    f"  [{datetime.now().strftime('%H:%M:%S')}] [CACHE-HIT] [{defense_key.upper()}] "
                    f"Pair {p_idx+1}/{len(target_pairs)} ({ut_id}, {it_id}): "
                    f"utility={u}, attack_succeeded={attack_succeeded} "
                    f"(Cumul: attack_succ={attack_success_count}/{pairs_evaluated}, util={utility_under_attack_count}/{pairs_evaluated})",
                    flush=True,
                )
            elif allow_legacy_cache:
                # Isolated historical reporting mode: NEVER run fresh tasks, NEVER mix into fresh metrics
                if legacy_cf.exists():
                    with open(legacy_cf, "r", encoding="utf-8") as f:
                        entry = json.load(f)
                        u = entry["utility"]
                        sec = entry["security"]
                        if missionpay_instance and entry.get("onchain_log"):
                            missionpay_instance.replay_log.append(entry["onchain_log"])
                        c_calls = entry.get("api_calls", 0)
                        cached_api_calls += c_calls
                        total_api_calls += c_calls
                        total_api_errors += entry.get("api_errors", 0)
                    pairs_evaluated += 1
                    if u:
                        utility_under_attack_count += 1
                    attack_succeeded = compute_attack_success(sec)
                    if attack_succeeded:
                        attack_success_count += 1
                    pair_details.append({
                        "user_task": ut_id,
                        "injection_task": it_id,
                        "utility": u,
                        "attack_succeeded": attack_succeeded,
                        "source": "legacy_historical",
                    })
                    print(
                        f"  [{datetime.now().strftime('%H:%M:%S')}] [LEGACY-HISTORICAL] [{defense_key.upper()}] "
                        f"Pair {p_idx+1}/{len(target_pairs)} ({ut_id}, {it_id}): "
                        f"utility={u}, attack_succeeded={attack_succeeded} "
                        f"(Cumul: attack_succ={attack_success_count}/{pairs_evaluated}, util={utility_under_attack_count}/{pairs_evaluated})",
                        flush=True,
                    )
                else:
                    pairs_evaluated += 1
                    pair_errors += 1
                    pair_details.append({
                        "user_task": ut_id,
                        "injection_task": it_id,
                        "utility": False,
                        "attack_succeeded": None,
                        "status": "MISSING_IN_LEGACY_CACHE",
                        "error": "MISSING_IN_LEGACY_CACHE",
                    })
            else:
                try:
                    task_spec = {
                        "suite_name": "banking",
                        "user_task_id": ut_id,
                        "inj_task_id": it_id,
                        "injections": injections,
                        "defense_key": defense_key,
                        "backend": backend,
                        "model": model,
                        "ollama_url": ollama_url,
                        "google_api_key": os.environ.get("GEMINI_API_KEY"),
                    }
                    task_result = run_agentdojo_task_in_subprocess(task_spec, timeout_seconds=600)
                    u = task_result["utility"]
                    sec = task_result["security"]
                    calls = task_result.get("api_calls", 0)
                    errors = task_result.get("api_errors", 0)
                    fresh_api_calls += calls
                    total_api_calls += calls
                    total_api_errors += errors
                    onchain_entry = task_result.get("onchain_log")
                    if missionpay_instance and onchain_entry:
                        missionpay_instance.replay_log.append(onchain_entry)

                    with open(cf, "w", encoding="utf-8") as f:
                        json.dump({
                            "schema_version": "2.0",
                            "fingerprint": ck,
                            "source": "live",
                            "backend": backend,
                            "model": model,
                            "model_digest": model_digest,
                            "user_task_id": ut_id,
                            "inj_task_id": it_id,
                            "defense_key": defense_key,
                            "defense_revision": get_defense_code_revision(defense_key),
                            "prompt_hash": hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:16],
                            "attack_hash": hashlib.sha256(attack_payload_text.encode("utf-8")).hexdigest()[:16],
                            "timestamp": datetime.now().isoformat(),
                            "utility": u,
                            "security": sec,
                            "api_calls": calls,
                            "api_errors": errors,
                            "onchain_log": onchain_entry,
                            "trace": task_result.get("trace") or (llm_wrapper.get_task_trace() if llm_wrapper else []),
                        }, f, indent=2)

                    pairs_evaluated += 1
                    if u:
                        utility_under_attack_count += 1
                    attack_succeeded = compute_attack_success(sec)
                    if attack_succeeded:
                        attack_success_count += 1

                    pair_details.append({
                        "user_task": ut_id,
                        "injection_task": it_id,
                        "utility": u,
                        "attack_succeeded": attack_succeeded,
                    })

                    print(
                        f"  [{datetime.now().strftime('%H:%M:%S')}] [LIVE] [{defense_key.upper()}] "
                        f"Pair {p_idx+1}/{len(target_pairs)} ({ut_id}, {it_id}): "
                        f"utility={u}, attack_succeeded={attack_succeeded} "
                        f"(Cumul: attack_succ={attack_success_count}/{pairs_evaluated}, util={utility_under_attack_count}/{pairs_evaluated})",
                        flush=True,
                    )
                except TimeoutError as te:
                    print(f"  [{datetime.now().strftime('%H:%M:%S')}] [TIMEOUT] Pair ({ut_id}, {it_id}) timed out after 600s: {te}", flush=True)
                    pair_errors += 1
                    unknown_call_tasks += 1
                    total_api_errors += 1
                    pair_details.append({
                        "user_task": ut_id,
                        "injection_task": it_id,
                        "utility": False,
                        "attack_succeeded": None,
                        "status": "TIMEOUT",
                        "error": "TIMEOUT",
                    })
                    save_checkpoint()
                    continue
                except Exception as e:
                    print(f"  [{datetime.now().strftime('%H:%M:%S')}] [ERROR] Pair ({ut_id}, {it_id}) failed: {e}", flush=True)
                    pair_errors += 1
                    unknown_call_tasks += 1
                    total_api_errors += 1
                    pair_details.append({
                        "user_task": ut_id,
                        "injection_task": it_id,
                        "utility": False,
                        "attack_succeeded": None,
                        "status": "ERROR",
                        "error": str(e),
                    })
                    save_checkpoint()
                    if "QUOTA_EXHAUSTED" in str(e) or "OLLAMA_SERVER_DOWN" in str(e):
                        break
                    continue
                time.sleep(0.5)

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
                "calls_count": total_api_calls,
                "fresh_calls": fresh_api_calls,
                "cached_calls": cached_api_calls,
                "errors_count": total_api_errors,
                "unknown_call_tasks": unknown_call_tasks,
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
        save_checkpoint()

    # Record total wall time
    overall_results["metadata"]["wall_time_seconds"] = round(time.time() - start_wall_time, 2)

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
- **Backend:** `{meta.get('backend', 'google')}`
- **Model:** `{meta['model']}`
- **Model Digest:** `{meta.get('model_digest', 'N/A')}`
- **Quantization:** `{meta.get('quantization', 'N/A')}`
- **Temperature:** `{meta.get('temperature', 0.0)}` | **Seed:** `{meta.get('seed', 42)}`
- **Wall Time:** `{meta.get('wall_time_seconds', 'N/A')}s`
- **Evaluated Defenses:** {', '.join(meta['defenses'])}
- **Pair Set:** `{meta.get('pair_set', 'N/A')}` ({meta.get('pairs_count', meta.get('sampled_pairs_count', 'N/A'))} pairs)
- **Sample Method:** {meta.get('sampling_method', 'N/A')} (Seed: {meta.get('sample_seed', 'N/A')})
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

    summary_path = Path(__file__).parent / "LIVE_SUMMARY.md"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(summary_md)
    print(f"[OK] Live summary markdown generated at: {summary_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AgentDojo Banking Defense Benchmark Runner")
    parser.add_argument("--backend", type=str, choices=["google", "ollama"], default="google", help="LLM backend: google or ollama")
    parser.add_argument("--model", type=str, default=None, help="Model name (e.g. qwen3:8b for ollama, gemini-3.1-flash-lite for google)")
    parser.add_argument("--ollama-url", type=str, default="http://127.0.0.1:11434", help="Ollama base URL (default: http://127.0.0.1:11434)")
    parser.add_argument("--defenses", nargs="+", default=["c0", "c2_strict"], help="Defenses to evaluate (c0, c1, c2_strict, c2_file_trusted)")
    parser.add_argument("--pairs", type=str, choices=["provguard", "random"], default="provguard", help="Pair selection strategy: 'provguard' (fixed 16x3 = 48 pairs, default) or 'random'")
    parser.add_argument("--sample", type=int, default=None, help="Sample size when using --pairs random (default 48)")
    parser.add_argument("--limit", type=int, default=None, help="Smoke test limit on evaluated pairs (e.g. --limit 2)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for sampling")
    parser.add_argument("--no-cache", action="store_true", help="Disable caching")
    parser.add_argument("--allow-legacy-cache", action="store_true", default=False, help="Allow loading legacy cache hits for historical audit (default: False)")

    args = parser.parse_args()
    run_benchmark(
        backend=args.backend,
        model=args.model,
        ollama_url=args.ollama_url,
        defenses=args.defenses,
        pairs=args.pairs,
        sample_size=args.sample,
        limit=args.limit,
        seed=args.seed,
        use_cache=not args.no_cache,
        allow_legacy_cache=args.allow_legacy_cache,
    )
