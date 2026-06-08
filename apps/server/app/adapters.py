from __future__ import annotations

import os, shutil, subprocess, time
from collections.abc import Callable
from dataclasses import dataclass

SAFE_TOOLSET = "safe"
DEFAULT_HERMES_TIMEOUT_SECONDS = 90
HERMES_FAILURE_MARKERS = ("API call failed after", "Final error:")
READ_ONLY_PROMPT_SUFFIX = (
    "Answer read-only. Do not take external actions, mutate files, send messages, "
    "or claim that an action was performed. If the user asks for an action, explain "
    "that it needs explicit confirmation in Hermes Voice Control."
)

@dataclass
class AdapterResult:
    ok: bool
    data: dict | None = None
    error_code: str | None = None
    safe_message: str | None = None

class HermesAdapter:
    def ask_agent(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        raise NotImplementedError

    def ask_bob(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        return self.ask_agent(message, mode=mode, transcript_window=transcript_window, should_cancel=should_cancel)

    def diagnostics(self) -> dict:
        return {"kind": "unknown", "available": False}

class MockHermesAdapter(HermesAdapter):
    def ask_agent(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        text = message.strip() or "I heard silence."
        return AdapterResult(ok=True, data={"speakable": f"Mock Hermes agent heard: {text}", "display": f"Mock Hermes agent heard: {text}", "mode": mode})

    def diagnostics(self) -> dict:
        return {"kind": "mock", "available": True, "read_only": True}

class LocalHermesAdapter(HermesAdapter):
    def __init__(self, hermes_bin: str, timeout_seconds: int = DEFAULT_HERMES_TIMEOUT_SECONDS):
        self.hermes_bin = hermes_bin
        self.timeout_seconds = timeout_seconds

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
            "read_only": True,
            "toolsets": [SAFE_TOOLSET],
            "timeout_seconds": self.timeout_seconds,
        }

    def _build_prompt(self, message: str, mode: str) -> str:
        return f"Voice message for the user's Hermes agent ({mode} mode):\n\n{message}\n\n{READ_ONLY_PROMPT_SUFFIX}"

    def _looks_like_cli_failure(self, output: str) -> bool:
        lines = [line.strip() for line in output.strip().splitlines() if line.strip()]
        return (
            1 < len(lines) <= 3
            and lines[0].startswith(HERMES_FAILURE_MARKERS[0])
            and any(line.startswith(HERMES_FAILURE_MARKERS[1]) for line in lines[1:])
        )

    def ask_agent(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        hermes_bin = self._resolve_hermes_bin()
        if not hermes_bin:
            return AdapterResult(ok=False, error_code="HERMES_NOT_FOUND", safe_message="Local Hermes binary was not found.")
        prompt = self._build_prompt(message, mode)
        try:
            proc = subprocess.Popen(
                [hermes_bin, "chat", "-Q", "-q", prompt, "--toolsets", SAFE_TOOLSET],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                text=True,
            )
            deadline = time.monotonic() + self.timeout_seconds
            while proc.poll() is None:
                if should_cancel and should_cancel():
                    proc.terminate()
                    try:
                        proc.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.communicate()
                    return AdapterResult(ok=False, error_code="HERMES_CANCELLED", safe_message="Tool call was cancelled.")
                if time.monotonic() >= deadline:
                    proc.kill()
                    proc.communicate()
                    return AdapterResult(ok=False, error_code="HERMES_TIMEOUT", safe_message="The Hermes agent took too long to answer.")
                time.sleep(0.1)
            stdout, _stderr = proc.communicate()
        except OSError:
            return AdapterResult(ok=False, error_code="HERMES_NOT_EXECUTABLE", safe_message="Local Hermes could not be executed.")
        if proc.returncode != 0:
            return AdapterResult(ok=False, error_code="HERMES_ERROR", safe_message="The Hermes agent could not answer right now.")
        output = stdout.strip()
        if not output:
            return AdapterResult(ok=False, error_code="HERMES_MALFORMED_OUTPUT", safe_message="Local Hermes returned an empty response.")
        if self._looks_like_cli_failure(output):
            return AdapterResult(ok=False, error_code="HERMES_AGENT_FAILURE", safe_message="Local Hermes returned a CLI failure instead of an agent answer.")
        return AdapterResult(ok=True, data={"speakable": output, "display": output, "mode": mode})

def build_adapter(kind: str, hermes_bin: str, timeout_seconds: int = DEFAULT_HERMES_TIMEOUT_SECONDS) -> HermesAdapter:
    return LocalHermesAdapter(hermes_bin, timeout_seconds=timeout_seconds) if kind == "local" else MockHermesAdapter()
