from __future__ import annotations

import os, shutil, subprocess, time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from .store import Store

SAFE_TOOLSET = "safe"
DEFAULT_HERMES_TIMEOUT_SECONDS = 90
HERMES_FAILURE_MARKERS = ("API call failed after", "Final error:")
DEFAULT_AGENT_NAME = "Hermes Agent"
READ_ONLY_PROMPT_SUFFIX = (
    "Answer read-only. Do not take external actions, mutate files, send messages, "
    "or claim that an action was performed. If the user asks for an action, explain "
    "that it needs explicit confirmation in Hermes Voice Control."
)

def agent_identity_prompt(agent_name: str) -> str:
    return (
        f"You are {agent_name}, the user's private Hermes agent voice interface. "
        f"If asked who you are, say you are {agent_name}. Do not introduce yourself "
        "as Hermes Voice Control; Hermes Voice Control is only the software surface "
        "carrying your answer."
    )

@dataclass
class AdapterResult:
    ok: bool
    data: dict | None = None
    status: str = "completed"
    error_code: str | None = None
    safe_message: str | None = None
    diagnostics: dict[str, Any] | None = None

class HermesAdapter:
    def ask_agent(
        self,
        message: str,
        mode: str = "quick",
        transcript_window: list[dict] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        session_hash: str | None = None,
        on_partial: Callable[[str], None] | None = None,
    ) -> AdapterResult:
        raise NotImplementedError

    def ask_bob(
        self,
        message: str,
        mode: str = "quick",
        transcript_window: list[dict] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        session_hash: str | None = None,
        on_partial: Callable[[str], None] | None = None,
    ) -> AdapterResult:
        return self.ask_agent(
            message,
            mode=mode,
            transcript_window=transcript_window,
            should_cancel=should_cancel,
            session_hash=session_hash,
            on_partial=on_partial,
        )

    def diagnostics(self) -> dict:
        return {"kind": "unknown", "available": False}

class MockHermesAdapter(HermesAdapter):
    def __init__(self, agent_name: str = DEFAULT_AGENT_NAME):
        self.agent_name = agent_name

    def ask_agent(
        self,
        message: str,
        mode: str = "quick",
        transcript_window: list[dict] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        session_hash: str | None = None,
        on_partial: Callable[[str], None] | None = None,
    ) -> AdapterResult:
        text = message.strip() or "I heard silence."
        answer = f"Mock {self.agent_name} heard: {text}"
        return AdapterResult(ok=True, data={"speakable": answer, "display": answer, "mode": mode})

    def diagnostics(self) -> dict:
        return {"kind": "mock", "available": True, "read_only": True}

class LocalHermesAdapter(HermesAdapter):
    def __init__(self, hermes_bin: str, timeout_seconds: int = DEFAULT_HERMES_TIMEOUT_SECONDS, agent_name: str = DEFAULT_AGENT_NAME):
        self.hermes_bin = hermes_bin
        self.timeout_seconds = timeout_seconds
        self.agent_name = agent_name

    def _resolve_hermes_bin(self) -> str | None:
        if os.path.sep in self.hermes_bin or (os.path.altsep and os.path.altsep in self.hermes_bin):
            return self.hermes_bin if os.path.isfile(self.hermes_bin) and os.access(self.hermes_bin, os.X_OK) else None
        return shutil.which(self.hermes_bin)

    def diagnostics(self) -> dict:
        resolved_bin = self._resolve_hermes_bin()
        return {
            "kind": "local",
            "available": resolved_bin is not None,
            "configured_bin": self.hermes_bin,
            "resolved_bin": resolved_bin,
            "command": [resolved_bin or self.hermes_bin, "chat", "-Q", "-q", "<read-only prompt>", "--toolsets", SAFE_TOOLSET],
            "command_mode": "quiet_chat_query",
            "read_only": True,
            "toolsets": [SAFE_TOOLSET],
            "timeout_seconds": self.timeout_seconds,
        }

    def _build_prompt(self, message: str, mode: str) -> str:
        return f"{agent_identity_prompt(self.agent_name)}\n\nVoice message for {self.agent_name} ({mode} mode):\n\n{message}\n\n{READ_ONLY_PROMPT_SUFFIX}"

    def _looks_like_cli_failure(self, output: str) -> bool:
        lines = [line.strip() for line in output.strip().splitlines() if line.strip()]
        return (
            1 < len(lines) <= 3
            and lines[0].startswith(HERMES_FAILURE_MARKERS[0])
            and any(line.startswith(HERMES_FAILURE_MARKERS[1]) for line in lines[1:])
        )

    def _build_command(self, hermes_bin: str, prompt: str) -> list[str]:
        return [hermes_bin, "chat", "-Q", "-q", prompt, "--toolsets", SAFE_TOOLSET]

    def _new_trace(self) -> tuple[dict[str, Any], float]:
        started = time.monotonic()
        trace: dict[str, Any] = {
            "adapter": "local_hermes",
            "command_mode": "quiet_chat_query",
            "timeout_seconds": self.timeout_seconds,
            "phases": [],
            "cleanup": {
                "terminated": False,
                "killed": False,
                "communicated": False,
                "return_code": None,
            },
            "output": {
                "stdout_present": False,
                "stderr_present": False,
                "stdout_streaming": False,
            },
        }
        return trace, started

    def _mark_trace(self, trace: dict[str, Any], started: float, name: str) -> None:
        trace["phases"].append({"name": name, "elapsed_ms": round((time.monotonic() - started) * 1000)})

    def _finish_trace(self, trace: dict[str, Any], started: float, error_code: str | None = None) -> dict[str, Any]:
        trace["duration_ms"] = round((time.monotonic() - started) * 1000)
        if error_code:
            trace["error_code"] = error_code
        return trace

    def ask_agent(
        self,
        message: str,
        mode: str = "quick",
        transcript_window: list[dict] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        session_hash: str | None = None,
        on_partial: Callable[[str], None] | None = None,
    ) -> AdapterResult:
        trace, trace_started = self._new_trace()
        self._mark_trace(trace, trace_started, "request_start")
        hermes_bin = self._resolve_hermes_bin()
        if not hermes_bin:
            self._mark_trace(trace, trace_started, "binary_missing")
            return AdapterResult(
                ok=False,
                error_code="HERMES_NOT_FOUND",
                safe_message="Local Hermes binary was not found.",
                diagnostics=self._finish_trace(trace, trace_started, "HERMES_NOT_FOUND"),
            )
        self._mark_trace(trace, trace_started, "binary_resolved")
        prompt = self._build_prompt(message, mode)
        try:
            self._mark_trace(trace, trace_started, "process_spawn_start")
            proc = subprocess.Popen(
                self._build_command(hermes_bin, prompt),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                text=True,
            )
            self._mark_trace(trace, trace_started, "process_spawned")
            deadline = time.monotonic() + self.timeout_seconds
            while proc.poll() is None:
                if should_cancel and should_cancel():
                    self._mark_trace(trace, trace_started, "cancellation_requested")
                    proc.terminate()
                    trace["cleanup"]["terminated"] = True
                    try:
                        proc.communicate(timeout=2)
                        trace["cleanup"]["communicated"] = True
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        trace["cleanup"]["killed"] = True
                        proc.communicate()
                        trace["cleanup"]["communicated"] = True
                    trace["cleanup"]["return_code"] = proc.returncode
                    self._mark_trace(trace, trace_started, "process_cancelled")
                    return AdapterResult(
                        ok=False,
                        error_code="HERMES_CANCELLED",
                        safe_message="Tool call was cancelled.",
                        diagnostics=self._finish_trace(trace, trace_started, "HERMES_CANCELLED"),
                    )
                if time.monotonic() >= deadline:
                    self._mark_trace(trace, trace_started, "timeout_reached")
                    proc.kill()
                    trace["cleanup"]["killed"] = True
                    stdout, stderr = proc.communicate()
                    trace["cleanup"]["communicated"] = True
                    trace["cleanup"]["return_code"] = proc.returncode
                    trace["output"]["stdout_present"] = bool(stdout.strip())
                    trace["output"]["stderr_present"] = bool(stderr.strip())
                    self._mark_trace(trace, trace_started, "process_killed")
                    return AdapterResult(
                        ok=False,
                        error_code="HERMES_TIMEOUT",
                        safe_message="The Hermes agent took too long to answer.",
                        diagnostics=self._finish_trace(trace, trace_started, "HERMES_TIMEOUT"),
                    )
                time.sleep(0.1)
            self._mark_trace(trace, trace_started, "process_exited")
            stdout, _stderr = proc.communicate()
            trace["cleanup"]["communicated"] = True
            trace["cleanup"]["return_code"] = proc.returncode
            trace["output"]["stdout_present"] = bool(stdout.strip())
            trace["output"]["stderr_present"] = bool(_stderr.strip())
            self._mark_trace(trace, trace_started, "stdio_collected")
        except OSError:
            self._mark_trace(trace, trace_started, "process_spawn_failed")
            return AdapterResult(
                ok=False,
                error_code="HERMES_NOT_EXECUTABLE",
                safe_message="Local Hermes could not be executed.",
                diagnostics=self._finish_trace(trace, trace_started, "HERMES_NOT_EXECUTABLE"),
            )
        if proc.returncode != 0:
            return AdapterResult(
                ok=False,
                error_code="HERMES_ERROR",
                safe_message="The Hermes agent could not answer right now.",
                diagnostics=self._finish_trace(trace, trace_started, "HERMES_ERROR"),
            )
        output = stdout.strip()
        if not output:
            return AdapterResult(
                ok=False,
                error_code="HERMES_MALFORMED_OUTPUT",
                safe_message="Local Hermes returned an empty response.",
                diagnostics=self._finish_trace(trace, trace_started, "HERMES_MALFORMED_OUTPUT"),
            )
        if self._looks_like_cli_failure(output):
            return AdapterResult(
                ok=False,
                error_code="HERMES_AGENT_FAILURE",
                safe_message="Local Hermes returned a CLI failure instead of an agent answer.",
                diagnostics=self._finish_trace(trace, trace_started, "HERMES_AGENT_FAILURE"),
            )
        self._mark_trace(trace, trace_started, "completion")
        return AdapterResult(ok=True, data={"speakable": output, "display": output, "mode": mode}, diagnostics=self._finish_trace(trace, trace_started))

def build_adapter(
    kind: str,
    hermes_bin: str,
    timeout_seconds: int = DEFAULT_HERMES_TIMEOUT_SECONDS,
    agent_name: str = DEFAULT_AGENT_NAME,
    store: Store | None = None,
    hermes_api_url: str = "",
    hermes_api_token: str = "",
    hermes_api_cwd: str = "",
) -> HermesAdapter:
    if kind == "local":
        return LocalHermesAdapter(hermes_bin, timeout_seconds=timeout_seconds, agent_name=agent_name)
    if kind == "api":
        from .hermes_api import ApiHermesAdapter

        return ApiHermesAdapter(
            api_url=hermes_api_url,
            token=hermes_api_token,
            store=store,
            timeout_seconds=timeout_seconds,
            agent_name=agent_name,
            cwd=hermes_api_cwd,
        )
    return MockHermesAdapter(agent_name=agent_name)
