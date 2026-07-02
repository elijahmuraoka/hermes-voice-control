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
CHAT_JOB_ID_HEADER = "X-HVC-Chat-Job-Id"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}
BROWSER_TEXT_FALLBACK_TIMEOUT_SECONDS = 15.0
DEFAULT_JOB_TIMEOUT_SECONDS = 120.0
DEFAULT_JOB_POLL_INTERVAL_SECONDS = 1.0
TAILSCALE_CGNAT = ipaddress.ip_network("100.64.0.0/10")
HOSTNAME_RE = re.compile(r"^[A-Za-z0-9.-]+$")
TERMINAL_JOB_STATES = {"complete", "cancelled", "failed", "needs_permission"}


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
    parser.add_argument("--sync", action="store_true", help="Use the legacy synchronous /chat/text path instead of the browser job path.")
    parser.add_argument("--interactive-budget-ms", default=os.getenv("HVC_LIVE_TEXT_INTERACTIVE_BUDGET_MS", "0"))
    parser.add_argument("--job-timeout-seconds", default=os.getenv("HVC_LIVE_TEXT_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS)))
    parser.add_argument("--job-poll-interval-seconds", default=os.getenv("HVC_LIVE_TEXT_JOB_POLL_INTERVAL_SECONDS", str(DEFAULT_JOB_POLL_INTERVAL_SECONDS)))
    parser.add_argument("--no-cancel-on-timeout", action="store_true")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    return parser.parse_args(argv)


def parse_timeout_seconds(value: object, label: str) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a numeric number of seconds") from exc
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError(f"{label} must be a positive finite number of seconds")
    return timeout


def parse_non_negative_int(value: object, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


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
        return {"ok": False, "status": None, "duration_ms": elapsed_ms(started), "timed_out": True, "error": "timeout", "headers": {}, "body": b""}
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


def response_header(headers: dict[str, str], name: str) -> str | None:
    for header_name, value in headers.items():
        if header_name.lower() == name.lower():
            return value
    return None


def parse_job_id(body: dict[str, Any] | None) -> str | None:
    if not body:
        return None
    value = body.get("job_id")
    return value if isinstance(value, str) and value else None


def summarize_job_status(body: dict[str, Any] | None, request_id: str) -> dict[str, Any]:
    if body is None:
        return {"json": False}
    state = body.get("state")
    summary: dict[str, Any] = {
        "json": True,
        "job_id_present": bool(parse_job_id(body)),
        "state": state if isinstance(state, str) else None,
        "request_id_matches": body.get("request_id") == request_id,
        "terminal": state in TERMINAL_JOB_STATES,
        "result_present": isinstance(body.get("result"), dict),
        "error_present": isinstance(body.get("error"), dict),
    }
    if state == "complete" and isinstance(body.get("result"), dict):
        summary["result"] = summarize_body(body["result"], request_id)
        diagnostics = body["result"].get("diagnostics")
        if isinstance(diagnostics, dict):
            summary["adapter_diagnostics"] = diagnostics
    error = body.get("error")
    if isinstance(error, dict):
        detail = error.get("detail")
        summary["error_status_code"] = error.get("status_code")
        summary["error_detail_chars"] = len(detail) if isinstance(detail, str) else None
        diagnostics = error.get("diagnostics")
        if isinstance(diagnostics, dict):
            summary["adapter_diagnostics"] = diagnostics
    return summary


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
    if evidence.get("text_mode") == "job" and status == 200 and not chat.get("job_id_header_present"):
        return "The /chat/text response did not include chat job evidence."
    if evidence.get("text_mode") == "job" and chat.get("http_status") == 202:
        job = evidence.get("job") or {}
        if chat.get("http_status") == 202 and not job.get("job_id_present"):
            return "The /chat/text job response did not include a job id."
        if job.get("timed_out"):
            return "The background text job did not finish before the job timeout."
        if job.get("error") == "url_error":
            return "The background text job status request was not reachable."
        if job.get("error") == "timeout":
            return "The background text job status request timed out."
        if job.get("http_status") and job.get("http_status") >= 400:
            return f"The background text job status request failed with HTTP {job.get('http_status')}."
        body = job.get("body", {})
        state = body.get("state")
        if state == "failed":
            return "The background text job failed."
        if state == "cancelled":
            return "The background text job was cancelled."
        if state == "needs_permission":
            return "The background text job needs explicit permission."
        result = body.get("result", {})
        if state == "complete" and body and body.get("result_present") is False:
            return "The completed background text job did not include a result."
        if body.get("request_id_matches") is False:
            return "The background text job status did not match the harness request id."
        if state == "complete" and body and result.get("result_present") is False:
            return "The completed background text job did not include a result."
        if result.get("request_id_matches") is False:
            return "The completed background text job did not match the harness request id."
        if result.get("speakable_chars") == 0 or result.get("display_chars") == 0:
            return "The completed background text job did not include a speakable/display answer."
        if state and state not in TERMINAL_JOB_STATES:
            return "The background text job did not reach a terminal state."
        if evidence.get("ok") is False:
            return "The background text job did not return a completed response."
        return None
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
        args.client_timeout_seconds = parse_timeout_seconds(args.client_timeout_seconds, "--client-timeout-seconds")
        if args.sync:
            args.job_timeout_seconds = None
            args.job_poll_interval_seconds = None
            args.interactive_budget_ms = None
        else:
            args.job_timeout_seconds = parse_timeout_seconds(args.job_timeout_seconds, "--job-timeout-seconds")
            args.job_poll_interval_seconds = parse_timeout_seconds(
                args.job_poll_interval_seconds, "--job-poll-interval-seconds"
            )
            args.interactive_budget_ms = parse_non_negative_int(args.interactive_budget_ms, "--interactive-budget-ms")
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
        "text_mode": "sync" if args.sync else "job",
        "message_chars": len(args.message),
        "client_timeout_seconds": args.client_timeout_seconds,
        "job_timeout_seconds": None if args.sync else args.job_timeout_seconds,
        "job_poll_interval_seconds": None if args.sync else args.job_poll_interval_seconds,
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
    if not args.sync:
        chat_payload["job"] = True
        chat_payload["interactive_budget_ms"] = args.interactive_budget_ms
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
    chat_job_id_header = response_header(chat.get("headers", {}), CHAT_JOB_ID_HEADER)
    adapter_diagnostics = extract_adapter_diagnostics(chat.get("headers", {}), chat_body)
    evidence["chat"] = {
        "http_status": chat.get("status"),
        "duration_ms": chat.get("duration_ms"),
        "timed_out": bool(chat.get("timed_out")),
        "browser_budget_exceeded": bool(chat.get("duration_ms") is not None)
        and chat["duration_ms"] > BROWSER_TEXT_FALLBACK_TIMEOUT_SECONDS * 1000,
        "error": chat.get("error"),
        "job_id_header_present": bool(chat_job_id_header),
        "body": summarize_body(chat_body, request_id),
        "adapter_diagnostics": adapter_diagnostics,
    }

    job_id = parse_job_id(chat_body)
    final_job_body: dict[str, Any] | None = None
    final_job_response: dict[str, Any] | None = None
    if not args.sync and chat.get("status") == 202:
        evidence["job"] = {
            "job_id_present": bool(job_id),
            "polls": [],
            "timed_out": False,
            "http_status": None,
            "duration_ms": None,
            "error": None,
            "body": summarize_job_status(chat_body, request_id),
        }
        if job_id:
            deadline = time.monotonic() + args.job_timeout_seconds
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    evidence["job"]["timed_out"] = True
                    break
                if evidence["job"]["polls"]:
                    time.sleep(min(args.job_poll_interval_seconds, max(0, remaining)))
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        evidence["job"]["timed_out"] = True
                        break
                mark(phases, started, "chat_job_poll_start")
                poll_timeout_seconds = min(args.client_timeout_seconds, remaining)
                poll = request_json(
                    opener,
                    f"{base_url}/chat/jobs/{urllib.parse.quote(job_id, safe='')}",
                    "GET",
                    None,
                    poll_timeout_seconds,
                )
                mark(phases, started, "chat_job_poll_finished", {"http_status": poll.get("status"), "timed_out": bool(poll.get("timed_out"))})
                poll_body = parse_json_body(poll.get("body", b""))
                poll_error = poll.get("error") or ("timeout" if poll.get("timed_out") else None)
                evidence["job"]["polls"].append({"http_status": poll.get("status"), "duration_ms": poll.get("duration_ms"), "timed_out": bool(poll.get("timed_out")), "error": poll_error, "state": poll_body.get("state") if isinstance(poll_body, dict) else None})
                evidence["job"]["http_status"] = poll.get("status")
                evidence["job"]["duration_ms"] = elapsed_ms(started)
                evidence["job"]["error"] = poll_error
                final_job_response = poll
                final_job_body = poll_body
                remaining_after_poll = deadline - time.monotonic()
                if poll.get("timed_out"):
                    if remaining_after_poll <= 0:
                        evidence["job"]["timed_out"] = True
                    break
                if remaining_after_poll <= 0:
                    evidence["job"]["timed_out"] = True
                    break
                if poll.get("status") != 200:
                    break
                state = poll_body.get("state") if isinstance(poll_body, dict) else None
                if state in TERMINAL_JOB_STATES:
                    evidence["job"]["body"] = summarize_job_status(poll_body, request_id)
                    break
            if final_job_body is not None:
                evidence["job"]["body"] = summarize_job_status(final_job_body, request_id)
    else:
        evidence["job"] = None

    if chat.get("timed_out") and not args.no_cancel_on_timeout:
        mark(phases, started, "cancel_request_start")
        if args.sync:
            cancel = request_json(opener, f"{base_url}/tools/cancel", "POST", {"request_ids": [request_id]}, min(args.client_timeout_seconds, 10))
            mark(phases, started, "cancel_request_finished", {"http_status": cancel.get("status")})
            evidence["cancellation"] = {
                "kind": "tool_request",
                "http_status": cancel.get("status"),
                "duration_ms": cancel.get("duration_ms"),
                "timed_out": bool(cancel.get("timed_out")),
            }
        elif job_id:
            cancel = request_json(opener, f"{base_url}/chat/jobs/{urllib.parse.quote(job_id, safe='')}/cancel", "POST", None, min(args.client_timeout_seconds, 10))
            mark(phases, started, "chat_job_cancel_request_finished", {"http_status": cancel.get("status")})
            evidence["cancellation"] = {
                "kind": "chat_job",
                "http_status": cancel.get("status"),
                "duration_ms": cancel.get("duration_ms"),
                "timed_out": bool(cancel.get("timed_out")),
            }
        else:
            mark(phases, started, "chat_job_cancel_skipped", {"reason": "job_id_unavailable_after_create_timeout"})
            evidence["cancellation"] = {
                "kind": "chat_job",
                "status": "not_attempted",
                "reason": "job_id_unavailable_after_create_timeout",
            }
    elif (
        not args.sync
        and job_id
        and evidence.get("job", {}).get("timed_out")
        and not args.no_cancel_on_timeout
    ):
        mark(phases, started, "chat_job_cancel_request_start")
        cancel = request_json(opener, f"{base_url}/chat/jobs/{urllib.parse.quote(job_id, safe='')}/cancel", "POST", None, min(args.client_timeout_seconds, 10))
        mark(phases, started, "chat_job_cancel_request_finished", {"http_status": cancel.get("status")})
        evidence["cancellation"] = {
            "kind": "chat_job",
            "http_status": cancel.get("status"),
            "duration_ms": cancel.get("duration_ms"),
            "timed_out": bool(cancel.get("timed_out")),
        }

    body_summary = evidence["chat"]["body"]
    if not args.sync and chat.get("status") == 202:
        job_body = evidence.get("job", {}).get("body", {})
        job_result = job_body.get("result", {}) if isinstance(job_body, dict) else {}
        evidence["ok"] = (
            job_body.get("state") == "complete"
            and job_body.get("request_id_matches") is True
            and job_result.get("status") == "completed"
            and job_result.get("request_id_matches") is True
            and job_result.get("result_present") is True
            and bool(job_result.get("speakable_chars"))
            and bool(job_result.get("display_chars"))
            and not evidence["job"]["timed_out"]
            and not evidence["job"].get("error")
            and not evidence["chat"]["browser_budget_exceeded"]
        )
    elif not args.sync:
        evidence["ok"] = (
            chat.get("status") == 200
            and bool(chat_job_id_header)
            and body_summary.get("status") == "completed"
            and body_summary.get("request_id_matches") is True
            and body_summary.get("result_present") is True
            and bool(body_summary.get("speakable_chars"))
            and bool(body_summary.get("display_chars"))
            and not evidence["chat"]["browser_budget_exceeded"]
        )
    else:
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
