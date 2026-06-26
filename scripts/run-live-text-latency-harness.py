#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.cookiejar
import ipaddress
import json
import math
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / ".private" / "evidence" / "live-text-latency-latest.json"
DEFAULT_BASE_URL = "http://127.0.0.1:8765"
DIAGNOSTICS_HEADER = "X-HVC-Adapter-Diagnostics"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}
BROWSER_TEXT_FALLBACK_TIMEOUT_SECONDS = 15.0
TAILSCALE_CGNAT = ipaddress.ip_network("100.64.0.0/10")
HOSTNAME_RE = re.compile(r"^[A-Za-z0-9.-]+$")


class PinLoadError(Exception):
    pass


def opt_in_enabled() -> bool:
    return os.getenv("HVC_LIVE_TEXT_HARNESS", "").strip().lower() in {"1", "true", "yes", "on"}


def remote_pin_opt_in_enabled() -> bool:
    return os.getenv("HVC_LIVE_TEXT_ALLOW_REMOTE_PIN", "").strip().lower() in {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an opt-in redacted latency probe against the live /chat/text path.")
    parser.add_argument("--base-url", default=os.getenv("HVC_LIVE_TEXT_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--message", default=os.getenv("HVC_LIVE_TEXT_MESSAGE", "hello"))
    parser.add_argument(
        "--client-timeout-seconds",
        default=os.getenv("HVC_LIVE_TEXT_TIMEOUT_SECONDS", str(BROWSER_TEXT_FALLBACK_TIMEOUT_SECONDS)),
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--pin-file", type=Path, default=Path(os.getenv("HVC_PIN_FILE")) if os.getenv("HVC_PIN_FILE") else None)
    parser.add_argument("--allow-remote-pin", action="store_true", default=remote_pin_opt_in_enabled())
    parser.add_argument("--no-cancel-on-timeout", action="store_true")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    return parser.parse_args(argv)


def parse_timeout_seconds(value: object) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("--client-timeout-seconds must be a numeric number of seconds") from exc
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("--client-timeout-seconds must be a positive finite number of seconds")
    return timeout


def redacted_target(base_url: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(base_url)
    host = parsed.hostname or ""
    try:
        port_present = parsed.port is not None
    except ValueError:
        port_present = True
    return {
        "scheme": parsed.scheme,
        "host_kind": host_kind(host),
        "port_present": port_present,
        "path_present": bool(parsed.path and parsed.path != "/"),
    }


def host_kind(host: str) -> str:
    if host in LOCAL_HOSTS:
        return "local"
    if host.endswith(".ts.net"):
        return "private_network"
    try:
        if ipaddress.ip_address(host) in TAILSCALE_CGNAT:
            return "private_network"
    except ValueError:
        pass
    return "remote_or_custom"


def host_is_well_formed(host: str) -> bool:
    if not host or any(char.isspace() or ord(char) < 32 for char in host):
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    return bool(HOSTNAME_RE.fullmatch(host))


def elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def mark(phases: list[dict[str, Any]], started: float, name: str, extra: dict[str, Any] | None = None) -> None:
    item = {"name": name, "elapsed_ms": elapsed_ms(started)}
    if extra:
        item.update(extra)
    phases.append(item)


def normalize_base_url(base_url: str) -> str:
    value = base_url.strip().rstrip("/")
    if not value:
        raise ValueError("--base-url must not be empty")
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError as exc:
        raise ValueError("--base-url must not contain a malformed host") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("--base-url must be an http(s) URL")
    host = parsed.hostname or ""
    if not host_is_well_formed(host):
        raise ValueError("--base-url must not contain a malformed host")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("--base-url must not contain a malformed port") from exc
    if parsed.scheme == "http" and host_kind(host) == "remote_or_custom":
        raise ValueError("--base-url must use https unless the target is localhost or a Tailscale private address")
    return value


def load_pin(pin_file: Path | None) -> str | None:
    if pin_file:
        try:
            return pin_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise PinLoadError("Configured PIN file could not be read.") from exc
    value = os.getenv("HVC_PIN")
    return value.strip() if value else None


def build_opener() -> urllib.request.OpenerDirector:
    cookie_jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def request_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    method: str,
    payload: dict[str, Any] | None,
    timeout_seconds: float,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(extra_headers or {})},
    )
    try:
        with opener.open(request, timeout=timeout_seconds) as response:
            body = response.read()
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "duration_ms": elapsed_ms(started),
                "headers": dict(response.headers.items()),
                "body": body,
            }
    except urllib.error.HTTPError as error:
        return {
            "ok": False,
            "status": error.code,
            "duration_ms": elapsed_ms(started),
            "headers": dict(error.headers.items()),
            "body": error.read(),
        }
    except (TimeoutError, socket.timeout):
        return {"ok": False, "status": None, "duration_ms": elapsed_ms(started), "timed_out": True, "headers": {}, "body": b""}
    except urllib.error.URLError as error:
        timed_out = isinstance(error.reason, (TimeoutError, socket.timeout))
        return {
            "ok": False,
            "status": None,
            "duration_ms": elapsed_ms(started),
            "timed_out": timed_out,
            "error": "timeout" if timed_out else "url_error",
            "headers": {},
            "body": b"",
        }


def parse_json_body(body: bytes) -> dict[str, Any] | None:
    if not body:
        return None
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def extract_adapter_diagnostics(headers: dict[str, str], body: dict[str, Any] | None) -> dict[str, Any] | None:
    header_value = None
    for name, value in headers.items():
        if name.lower() == DIAGNOSTICS_HEADER.lower():
            header_value = value
            break
    if header_value:
        try:
            parsed = json.loads(header_value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {"parse_error": True}
    diagnostics = body.get("diagnostics") if body else None
    return diagnostics if isinstance(diagnostics, dict) else None


def summarize_body(body: dict[str, Any] | None, request_id: str) -> dict[str, Any]:
    if body is None:
        return {"json": False}
    result = body.get("result")
    evidence: dict[str, Any] = {
        "json": True,
        "status": body.get("status") if isinstance(body.get("status"), str) else None,
        "request_id_matches": body.get("request_id") == request_id,
        "result_present": isinstance(result, dict),
    }
    if isinstance(result, dict):
        speakable = result.get("speakable")
        display = result.get("display")
        evidence["speakable_chars"] = len(speakable) if isinstance(speakable, str) else None
        evidence["display_chars"] = len(display) if isinstance(display, str) else None
    detail = body.get("detail")
    if detail is not None:
        evidence["detail_type"] = type(detail).__name__
        evidence["detail_chars"] = len(detail) if isinstance(detail, str) else None
    return evidence


def blocker_for(evidence: dict[str, Any]) -> str | None:
    if evidence.get("auth", {}).get("status") == "blocked":
        return "Authentication was required and no PIN was supplied."
    if evidence.get("auth", {}).get("error") == "url_error" or evidence.get("chat", {}).get("error") == "url_error":
        return "The target HVC server was not reachable."
    chat = evidence.get("chat", {})
    if chat.get("timed_out"):
        return "The /chat/text request exceeded the client timeout."
    if chat.get("browser_budget_exceeded"):
        return "The /chat/text request exceeded the browser text fallback timeout."
    status = chat.get("http_status")
    if status and status >= 400:
        return f"The /chat/text request failed with HTTP {status}."
    body = chat.get("body", {})
    if body.get("result_present") is False:
        return "The /chat/text response did not include a result."
    if body.get("request_id_matches") is False:
        return "The /chat/text response did not match the harness request id."
    if body.get("speakable_chars") == 0 or body.get("display_chars") == 0:
        return "The /chat/text response did not include a speakable/display answer."
    if evidence.get("ok") is False:
        return "The /chat/text request did not return a completed response."
    return None


def main() -> int:
    args = parse_args()
    try:
        args.client_timeout_seconds = parse_timeout_seconds(args.client_timeout_seconds)
    except ValueError as error:
        print(json.dumps({"ok": False, "error": str(error)}, indent=2))
        return 2

    if not opt_in_enabled():
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Set HVC_LIVE_TEXT_HARNESS=1 to intentionally run the live text latency harness.",
                    "safe_command": "HVC_LIVE_TEXT_HARNESS=1 pnpm hermes:text-latency -- --base-url http://127.0.0.1:8765",
                },
                indent=2,
            )
        )
        return 2

    try:
        base_url = normalize_base_url(args.base_url)
    except ValueError as error:
        print(json.dumps({"ok": False, "error": str(error)}, indent=2))
        return 2

    started = time.monotonic()
    phases: list[dict[str, Any]] = []
    request_id = f"latency-{int(time.time() * 1000)}"
    evidence: dict[str, Any] = {
        "ok": False,
        "ran_at": datetime.now(UTC).isoformat(),
        "target": redacted_target(base_url),
        "request_id": request_id,
        "message_chars": len(args.message),
        "client_timeout_seconds": args.client_timeout_seconds,
        "browser_timeout_budget_seconds": BROWSER_TEXT_FALLBACK_TIMEOUT_SECONDS,
        "cancel_on_timeout": not args.no_cancel_on_timeout,
        "phases": phases,
    }
    mark(phases, started, "harness_start")
    opener = build_opener()

    session = request_json(opener, f"{base_url}/auth/session", "GET", None, args.client_timeout_seconds)
    mark(phases, started, "auth_session_checked", {"http_status": session.get("status")})
    evidence["auth"] = {"session_http_status": session.get("status"), "session_duration_ms": session.get("duration_ms"), "error": session.get("error")}

    if session.get("status") == 401:
        if evidence["target"]["host_kind"] == "remote_or_custom" and not args.allow_remote_pin:
            evidence["auth"]["status"] = "blocked"
            evidence["auth"]["pin_submission"] = "blocked_remote_target"
            evidence["blocker"] = "Automatic PIN login is disabled for remote/custom targets."
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({"ok": False, "output": str(args.output), "blocker": evidence["blocker"]}, indent=2))
            return 1
        try:
            pin = load_pin(args.pin_file)
        except PinLoadError as error:
            evidence["auth"]["status"] = "blocked"
            evidence["auth"]["pin_file_error"] = "unreadable"
            evidence["blocker"] = str(error)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({"ok": False, "output": str(args.output), "blocker": evidence["blocker"]}, indent=2))
            return 1
        if not pin:
            evidence["auth"]["status"] = "blocked"
            evidence["blocker"] = blocker_for(evidence)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({"ok": False, "output": str(args.output), "blocker": evidence["blocker"]}, indent=2))
            return 1
        login = request_json(opener, f"{base_url}/auth/pin", "POST", {"pin": pin}, args.client_timeout_seconds)
        mark(phases, started, "auth_pin_submitted", {"http_status": login.get("status")})
        evidence["auth"]["login_http_status"] = login.get("status")
        evidence["auth"]["login_duration_ms"] = login.get("duration_ms")

    chat_payload = {"request_id": request_id, "message": args.message, "mode": "quick", "transcript_window": []}
    mark(phases, started, "chat_text_request_start")
    chat = request_json(
        opener,
        f"{base_url}/chat/text",
        "POST",
        chat_payload,
        args.client_timeout_seconds,
        extra_headers={DIAGNOSTICS_HEADER: "1"},
    )
    mark(phases, started, "chat_text_request_finished", {"http_status": chat.get("status"), "timed_out": bool(chat.get("timed_out"))})
    chat_body = parse_json_body(chat.get("body", b""))
    adapter_diagnostics = extract_adapter_diagnostics(chat.get("headers", {}), chat_body)
    evidence["chat"] = {
        "http_status": chat.get("status"),
        "duration_ms": chat.get("duration_ms"),
        "timed_out": bool(chat.get("timed_out")),
        "browser_budget_exceeded": bool(chat.get("duration_ms") is not None)
        and chat["duration_ms"] > BROWSER_TEXT_FALLBACK_TIMEOUT_SECONDS * 1000,
        "error": chat.get("error"),
        "body": summarize_body(chat_body, request_id),
        "adapter_diagnostics": adapter_diagnostics,
    }

    if chat.get("timed_out") and not args.no_cancel_on_timeout:
        mark(phases, started, "cancel_request_start")
        cancel = request_json(opener, f"{base_url}/tools/cancel", "POST", {"request_ids": [request_id]}, min(args.client_timeout_seconds, 10))
        mark(phases, started, "cancel_request_finished", {"http_status": cancel.get("status")})
        evidence["cancellation"] = {
            "http_status": cancel.get("status"),
            "duration_ms": cancel.get("duration_ms"),
            "timed_out": bool(cancel.get("timed_out")),
        }

    body_summary = evidence["chat"]["body"]
    evidence["ok"] = (
        chat.get("status") == 200
        and body_summary.get("status") == "completed"
        and body_summary.get("request_id_matches") is True
        and body_summary.get("result_present") is True
        and bool(body_summary.get("speakable_chars"))
        and bool(body_summary.get("display_chars"))
        and not evidence["chat"]["browser_budget_exceeded"]
    )
    evidence["duration_ms"] = elapsed_ms(started)
    evidence["blocker"] = blocker_for(evidence)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "ok": evidence["ok"],
                "output": str(args.output),
                "http_status": evidence["chat"]["http_status"],
                "timed_out": evidence["chat"]["timed_out"],
                "blocker": evidence.get("blocker"),
            },
            indent=2,
        )
    )
    return 0 if evidence["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
