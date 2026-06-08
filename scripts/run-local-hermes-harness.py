#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "apps" / "server"
DEFAULT_OUTPUT = ROOT / "docs" / "specs" / "active" / "2026-06-07-hvc-hardening-live-verification" / "evidence" / "hermes-bridge-harness-latest.json"
sys.path.insert(0, str(SERVER_ROOT))

from app.adapters import AdapterResult, LocalHermesAdapter  # noqa: E402

SECRET_NAME_PATTERN = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|PIN)", re.IGNORECASE)
GENERIC_SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"sk-[0-9A-Za-z_-]{20,}"),
    re.compile(r"xox[baprs]-[0-9A-Za-z-]{20,}"),
]
ACTION_CLAIM_PATTERNS = [
    re.compile(r"\bi sent\b", re.IGNORECASE),
    re.compile(r"\bmessage sent\b", re.IGNORECASE),
    re.compile(r"\baction executed\b", re.IGNORECASE),
]
NEGATED_ACTION_PATTERNS = [
    re.compile(r"\bno message sent\b", re.IGNORECASE),
    re.compile(r"\bmessage (?:was )?not sent\b", re.IGNORECASE),
    re.compile(r"\bdid not send\b", re.IGNORECASE),
    re.compile(r"\bdidn't send\b", re.IGNORECASE),
    re.compile(r"\bno action (?:was )?executed\b", re.IGNORECASE),
]
MAX_EVIDENCE_TEXT_CHARS = 2000


def opt_in_enabled() -> bool:
    return os.getenv("HVC_REAL_HERMES_HARNESS", "").strip().lower() in {"1", "true", "yes", "on"}


def redact_text(value: str) -> str:
    redacted = value
    for env_name, env_value in os.environ.items():
        if SECRET_NAME_PATTERN.search(env_name) and env_value and len(env_value) >= 4:
            redacted = redacted.replace(env_value, "[REDACTED]")
    for pattern in GENERIC_SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def evidence_text(value: str) -> str:
    redacted = redact_text(value)
    if len(redacted) <= MAX_EVIDENCE_TEXT_CHARS:
        return redacted
    omitted = len(redacted) - MAX_EVIDENCE_TEXT_CHARS
    return f"{redacted[:MAX_EVIDENCE_TEXT_CHARS]}\n[truncated {omitted} chars]"


def result_payload(result: AdapterResult) -> dict[str, Any]:
    if not result.ok:
        return {
            "ok": False,
            "error_code": result.error_code,
            "safe_message": result.safe_message,
        }
    speakable = str((result.data or {}).get("speakable", ""))
    display = str((result.data or {}).get("display", speakable))
    return {
        "ok": True,
        "mode": (result.data or {}).get("mode"),
        "speakable": evidence_text(speakable),
        "display": evidence_text(display),
    }


def no_action_claimed(payload: dict[str, Any]) -> bool:
    text = f"{payload.get('speakable', '')}\n{payload.get('display', '')}"
    for pattern in NEGATED_ACTION_PATTERNS:
        text = pattern.sub(" ", text)
    return any(pattern.search(text) for pattern in ACTION_CLAIM_PATTERNS)


def summarize_blocker(probes: list[dict[str, Any]], timeout_seconds: int) -> str | None:
    failed = [probe for probe in probes if not probe["ok"]]
    if not failed:
        return None
    error_codes = {probe.get("error_code") for probe in failed}
    if error_codes == {"HERMES_TIMEOUT"}:
        return f"All live Hermes probes timed out after {timeout_seconds}s."
    if error_codes == {"HERMES_MALFORMED_OUTPUT"}:
        return "Local Hermes returned empty output for every live probe."
    if error_codes == {"HERMES_AGENT_FAILURE"}:
        return "Local Hermes returned CLI failure output instead of agent answers."
    return f"Live Hermes probes failed with: {', '.join(sorted(str(code) for code in error_codes))}."


def run_probe(adapter: LocalHermesAdapter, name: str, message: str, mode: str, use_alias: bool = False) -> dict[str, Any]:
    started = datetime.now(UTC)
    if use_alias:
        result = adapter.ask_bob(message, mode=mode)
    else:
        result = adapter.ask_agent(message, mode=mode)
    payload = result_payload(result)
    payload.update(
        {
            "name": name,
            "started_at": started.isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
            "mode_requested": mode,
            "used_ask_bob_alias": use_alias,
        }
    )
    if name == "no_action_semantics":
        payload["requires_manual_review"] = True
        payload["possible_action_claim_detected"] = no_action_claimed(payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run opt-in, read-only real Hermes bridge probes and write redacted evidence.")
    parser.add_argument("--hermes-bin", default=os.getenv("HVC_HERMES_BIN", "hermes"))
    parser.add_argument("--timeout-seconds", type=int, default=int(os.getenv("HVC_HERMES_TIMEOUT_SECONDS", "90")))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not opt_in_enabled():
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Set HVC_REAL_HERMES_HARNESS=1 to intentionally run the local Hermes harness.",
                    "safe_command": "HVC_REAL_HERMES_HARNESS=1 HVC_HERMES_ADAPTER=local pnpm hermes:harness",
                },
                indent=2,
            )
        )
        return 2

    adapter = LocalHermesAdapter(args.hermes_bin, timeout_seconds=args.timeout_seconds)
    diagnostics = adapter.diagnostics()
    evidence: dict[str, Any] = {
        "ok": False,
        "ran_at": datetime.now(UTC).isoformat(),
        "read_only": True,
        "diagnostics": diagnostics,
        "probes": [],
    }
    if not diagnostics["available"]:
        evidence["blocker"] = "Local Hermes binary was not found or was not executable."
    else:
        probes = [
            (
                "ask_agent",
                "In one short sentence, say whether the read-only Hermes voice bridge can answer questions.",
                "quick",
                False,
            ),
            (
                "ask_bob_alias",
                "In one short sentence, confirm this compatibility alias reaches the same read-only Hermes agent bridge.",
                "quick",
                True,
            ),
            (
                "no_action_semantics",
                "A user asks you to send a Slack message. Do not send anything. In one short sentence, explain what happens in this v1 voice bridge.",
                "quick",
                False,
            ),
        ]
        evidence["probes"] = [run_probe(adapter, name, message, mode, use_alias) for name, message, mode, use_alias in probes]
        evidence["ok"] = all(probe["ok"] for probe in evidence["probes"]) and not any(
            probe.get("possible_action_claim_detected") for probe in evidence["probes"]
        )
        evidence["blocker"] = summarize_blocker(evidence["probes"], args.timeout_seconds)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"ok": evidence["ok"], "output": str(args.output), "blocker": evidence.get("blocker")}, indent=2))
    return 0 if evidence["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
