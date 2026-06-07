from __future__ import annotations

import os, shutil, subprocess, time
from collections.abc import Callable
from dataclasses import dataclass

@dataclass
class AdapterResult:
    ok: bool
    data: dict | None = None
    error_code: str | None = None
    safe_message: str | None = None

class HermesAdapter:
    def ask_bob(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        raise NotImplementedError

class MockHermesAdapter(HermesAdapter):
    def ask_bob(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        text = message.strip() or "I heard silence."
        return AdapterResult(ok=True, data={"speakable": f"Mock Bob heard: {text}", "display": f"Mock Bob heard: {text}", "mode": mode})

class LocalHermesAdapter(HermesAdapter):
    def __init__(self, hermes_bin: str):
        self.hermes_bin = hermes_bin
    def _resolve_hermes_bin(self) -> str | None:
        if os.path.sep in self.hermes_bin or (os.path.altsep and os.path.altsep in self.hermes_bin):
            return self.hermes_bin if os.path.exists(self.hermes_bin) else None
        return shutil.which(self.hermes_bin)
    def ask_bob(self, message: str, mode: str = "quick", transcript_window: list[dict] | None = None, should_cancel: Callable[[], bool] | None = None) -> AdapterResult:
        hermes_bin = self._resolve_hermes_bin()
        if not hermes_bin:
            return AdapterResult(ok=False, error_code="HERMES_NOT_FOUND", safe_message="Local Hermes binary was not found.")
        prompt = (
            f"Voice message for Bob ({mode} mode):\n\n{message}\n\n"
            "Answer read-only. Do not take external actions, mutate files, send messages, "
            "or claim that an action was performed. If the user asks for an action, explain "
            "that it needs explicit confirmation in Hermes Voice Control."
        )
        try:
            proc = subprocess.Popen(
                [hermes_bin, "chat", "-q", prompt, "--toolsets", "safe"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            deadline = time.monotonic() + 90
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
                    return AdapterResult(ok=False, error_code="HERMES_TIMEOUT", safe_message="Bob took too long to answer.")
                time.sleep(0.1)
            stdout, _stderr = proc.communicate()
        except OSError:
            return AdapterResult(ok=False, error_code="HERMES_NOT_EXECUTABLE", safe_message="Local Hermes could not be executed.")
        if proc.returncode != 0:
            return AdapterResult(ok=False, error_code="HERMES_ERROR", safe_message="Bob could not answer right now.")
        output = stdout.strip()
        return AdapterResult(ok=True, data={"speakable": output, "display": output, "mode": mode})

def build_adapter(kind: str, hermes_bin: str) -> HermesAdapter:
    return LocalHermesAdapter(hermes_bin) if kind == "local" else MockHermesAdapter()
